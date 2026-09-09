"""One-time controlled admin activation. Never deploy intake or maintenance.

Uses the existing repository deployment credential; never prints tokens/config values,
creates users, writes candidate/vacancy data, or modifies another function.
"""
import json
import os
from pathlib import Path
import shutil
import re
import subprocess
import sys
import urllib.request

PROJECT = "demac-corporation"
REGION = "us-central1"
FUNCTION = "careersAdmin"
ORIGINS = ["https://demac-aruba.com", "https://www.demac-aruba.com",
           "https://demac-corporation.vercel.app", "https://demac-corporation-web.vercel.app"]


def gcloud(*args):
    result = subprocess.run(["gcloud", *args, "--project=" + PROJECT, "--quiet"],
                            text=True, capture_output=True, check=False)
    if result.returncode:
        # gcloud diagnostics can contain configuration; do not print raw output.
        codes = re.findall(r"PERMISSION_DENIED|NOT_FOUND|INVALID_ARGUMENT|RESOURCE_EXHAUSTED|UNAUTHENTICATED|FAILED_PRECONDITION|SERVICE_DISABLED|BUILD_FAILED", result.stderr)
        raise RuntimeError("Google Cloud command failed: " + " ".join(args[:3]) + " " + ", ".join(sorted(set(codes))))
    return result.stdout.strip()


def describe(name):
    return json.loads(gcloud("functions", "describe", name, "--gen2", "--region=" + REGION,
                             "--format=json"))


def release_environment(firebase_config):
    if firebase_config.get("projectId") != PROJECT or not firebase_config.get("storageBucket"):
        raise ValueError("Unable to resolve DEMAC Firebase configuration.")
    return {"FIREBASE_CONFIG": json.dumps({"projectId": PROJECT, "storageBucket": firebase_config["storageBucket"]}),
            "DEMAC_CAREERS_BACKEND_ENABLED": "true", "CAREERS_RELEASE_APPROVED": "false",
            "CAREERS_RETENTION_APPROVED": "false", "CAREERS_ALLOWED_ORIGINS": ",".join(ORIGINS)}


def assert_not_live(existing):
    env = existing.get("serviceConfig", {}).get("environmentVariables", {})
    if env.get("CAREERS_RELEASE_APPROVED") == "true" or env.get("CAREERS_RETENTION_APPROVED") == "true":
        raise RuntimeError("This admin-preparation release cannot replace an activated Careers deployment.")


def probe(url, method, headers, expected):
    import urllib.error
    payload = json.dumps({"action": "vacancies.list", "payload": {}}).encode() if method == "POST" else None
    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as response:
        if response.code != expected:
            raise RuntimeError(f"Admin access verification failed: expected {expected}, received {response.code}") from None
        return
    if response.status != expected:
        raise RuntimeError(f"Admin access verification failed: expected {expected}, received {response.status}")
    if method == "OPTIONS" and response.headers.get("Access-Control-Allow-Origin") != headers["Origin"]:
        raise RuntimeError("Admin CORS response did not preserve the exact approved origin.")


def main():
    if os.environ.get("GITHUB_REF") != "refs/heads/main" or os.environ.get("GITHUB_EVENT_NAME") != "push":
        raise RuntimeError("Deployment is restricted to a reviewed push on main.")
    sha = os.environ.get("GITHUB_SHA", "")
    if len(sha) != 40:
        raise RuntimeError("Missing exact release commit.")
    inventory = json.loads(gcloud("functions", "list", "--v2", "--regions=" + REGION, "--format=json"))
    names = {item["name"].rsplit("/", 1)[-1]: item for item in inventory}
    existing = describe(FUNCTION) if FUNCTION in names else {}
    assert_not_live(existing)
    # Reuse a resolved runtime identity; never guess an account or grant new roles.
    reference = next((name for name in [FUNCTION, "adminManageUser", "generateProfessionalCustomerReport", "wacliWebhook"] if name in names), None)
    if not reference:
        raise RuntimeError("No existing DEMAC runtime identity was found.")
    reference_config = describe(reference)
    runtime_sa = reference_config.get("serviceConfig", {}).get("serviceAccountEmail")
    if not runtime_sa:
        raise RuntimeError("Missing DEMAC runtime identity.")
    before = {name: describe(name).get("updateTime") for name in ("careersPublic", "careersMaintenance") if name in names}
    # Reuse provider configuration when present; otherwise request the Admin SDK artifact.
    # Neither path guesses a bucket name or prints environment values.
    config_text = reference_config.get("serviceConfig", {}).get("environmentVariables", {}).get("FIREBASE_CONFIG", "")
    sdk = json.loads(config_text) if config_text.startswith("{") else {}
    if not sdk.get("storageBucket"):
        token = gcloud("auth", "print-access-token")
        sdk_request = urllib.request.Request(f"https://firebase.googleapis.com/v1beta1/projects/{PROJECT}/adminSdkConfig",
                                             headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(sdk_request, timeout=30) as response:
            sdk = json.load(response)
        del token
    environment = release_environment(sdk)
    bucket = sdk["storageBucket"]
    if not isinstance(bucket, str) or not bucket or "/" in bucket:
        raise RuntimeError("Invalid Firebase storage bucket metadata.")
    gcloud("storage", "buckets", "describe", "gs://" + bucket, "--format=value(name)")
    temp = Path(os.environ["RUNNER_TEMP"]) / ("careers-admin-" + sha[:12])
    temp.mkdir(mode=0o700, exist_ok=True)
    source = temp / "source"
    source.mkdir(exist_ok=True)
    # Only the Careers subtree and its dependency manifest enter the upload bundle.
    shutil.copytree("functions/careers", source / "careers", dirs_exist_ok=True)
    for name in ("careers.js", "careers-admin-entry.cjs"):
        shutil.copy2(Path("functions") / name, source / name)
    package = json.loads(Path("functions/package.json").read_text())
    package["main"] = "careers-admin-entry.cjs"
    package["scripts"] = {}
    (source / "package.json").write_text(json.dumps(package))
    (source / ".gcloudignore").write_text("node_modules/\n*.log\n.env*\ncareers/*.test.js\ncareers/*emulator.cjs\ncareers/test-support/\n")
    environment_path = temp / "environment.yaml"
    # JSON is a YAML subset. This file contains non-secret configuration only.
    environment_path.write_text(json.dumps(environment))
    print("Deploying the existing careersAdmin authority only; public intake and maintenance stay OFF.", flush=True)
    gcloud("functions", "deploy", FUNCTION, "--gen2", "--region=" + REGION, "--runtime=nodejs22",
           "--source=" + str(source), "--entry-point=" + FUNCTION, "--trigger-http",
           "--run-service-account=" + runtime_sa, "--memory=512Mi", "--timeout=90s",
           "--max-instances=3", "--min-instances=0", "--concurrency=1",
           "--env-vars-file=" + str(environment_path), "--allow-unauthenticated")
    actual = describe(FUNCTION)
    if actual.get("state") != "ACTIVE":
        raise RuntimeError("careersAdmin is not ACTIVE.")
    deployed_env = actual.get("serviceConfig", {}).get("environmentVariables", {})
    for key in ("DEMAC_CAREERS_BACKEND_ENABLED", "CAREERS_RELEASE_APPROVED", "CAREERS_RETENTION_APPROVED"):
        if deployed_env.get(key) != environment[key]:
            raise RuntimeError("Careers release guards do not match the approved admin-only mode.")
    for name, update_time in before.items():
        if describe(name).get("updateTime") != update_time:
            raise RuntimeError("A concurrent change affected another Careers function; review before proceeding.")
    endpoint = f"https://{REGION}-{PROJECT}.cloudfunctions.net/{FUNCTION}"
    for origin in ORIGINS:
        probe(endpoint, "OPTIONS", {"Origin": origin, "Access-Control-Request-Method": "POST",
                                     "Access-Control-Request-Headers": "authorization,content-type"}, 204)
    probe(endpoint, "POST", {"Content-Type": "application/json", "Origin": ORIGINS[0]}, 401)
    probe(endpoint, "POST", {"Content-Type": "application/json", "Origin": ORIGINS[0], "Authorization": "Bearer invalid-test-token"}, 401)
    probe(endpoint, "POST", {"Content-Type": "application/json", "Origin": "https://not-approved.example"}, 403)
    print("PASS: admin endpoint ACTIVE; approved-origin preflights; missing/invalid Firebase tokens denied; foreign origin denied.")
    print("No production vacancies, applicants, users, emails or document uploads were created by these checks.")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write("## Careers admin deployment\n" + f"Commit: `{sha}`. Only `careersAdmin` deployed and ACTIVE.\n"
                      + "Firebase-authenticated administration enabled; public release and retention guards OFF.\n"
                      + "4 approved-origin preflights, missing/invalid-token denial and foreign-origin denial passed.\n"
                      + "No production candidate/vacancy writes or owner impersonation. First authenticated owner save still requires in-session verification.\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never expose raw provider exceptions (which may contain config or tokens).
        print("::error::Careers admin deployment stopped safely: " + (str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
