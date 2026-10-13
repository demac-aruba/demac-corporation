"""Read fixed Google metadata endpoints only; never access a secret payload."""
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone

PROJECT = 'demac-corporation'
PROJECT_NUMBER = '1053571783393'
SECRETS = ('QBO_PRODUCTION_CLIENT_ID', 'QBO_PRODUCTION_CLIENT_SECRET', 'QBO_PRODUCTION_TOKEN_KEY')
FUNCTIONS = ('quickbooksConnection', 'quickbooksSandbox')
ENDPOINTS = {
    **{name: f'https://secretmanager.googleapis.com/v1/projects/{PROJECT}/secrets/{name}/versions?pageSize=10' for name in SECRETS},
    **{name: f'https://cloudfunctions.googleapis.com/v2/projects/{PROJECT}/locations/us-central1/functions/{name}' for name in FUNCTIONS},
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_metadata(label, token, opener):
    request = urllib.request.Request(ENDPOINTS[label], headers={'Authorization': 'Bearer ' + token}, method='GET')
    try:
        with opener.open(request, timeout=20) as response:
            raw = response.read(65537)
            if len(raw) > 65536:
                return 502, None
            result = json.loads(raw)
            return (200, result) if isinstance(result, dict) else (502, None)
    except urllib.error.HTTPError as error:
        # Do not print provider response bodies, URLs, headers or authentication data.
        return error.code, None
    except Exception:
        return 502, None


def secret_metadata(name, status, data):
    result = {'name': name, 'httpStatus': status, 'exists': status == 200, 'enabledVersions': []}
    if status != 200:
        return result
    pattern = rf'projects/(?:{PROJECT}|{PROJECT_NUMBER})/secrets/{name}/versions/(\d+)'
    for version in data.get('versions', []):
        match = re.fullmatch(pattern, str(version.get('name', '')))
        if match and version.get('state') == 'ENABLED':
            result['enabledVersions'].append(match.group(1))
    result['moreVersionsExist'] = bool(data.get('nextPageToken'))
    return result


def function_metadata(name, status, data):
    result = {'name': name, 'httpStatus': status, 'exists': status == 200}
    if status != 200:
        return result
    if data.get('name') != f'projects/{PROJECT}/locations/us-central1/functions/{name}':
        return {'name': name, 'httpStatus': 502, 'exists': False, 'identityMismatch': True}
    service = data.get('serviceConfig', {})
    revision = service.get('revision', '')
    result.update({
        'active': data.get('state') == 'ACTIVE',
        'node22': data.get('buildConfig', {}).get('runtime') == 'nodejs22',
        'expectedEntryPoint': data.get('buildConfig', {}).get('entryPoint') == name,
        'revision': revision if re.fullmatch(r'[a-z0-9-]{1,100}', revision) else None,
        'eventTriggerPresent': bool(data.get('eventTrigger')),
        'productionEnabled': service.get('environmentVariables', {}).get('QBO_PRODUCTION_ENABLED') == 'true',
    })
    return result


def report_metadata(token, opener):
    report = {'project': PROJECT, 'checkedAt': datetime.now(timezone.utc).isoformat(),
              'readOnly': True, 'secretPayloadsAccessed': False, 'providerCalls': False,
              'secrets': [], 'functions': []}
    for name in SECRETS:
        report['secrets'].append(secret_metadata(name, *read_metadata(name, token, opener)))
    for name in FUNCTIONS:
        report['functions'].append(function_metadata(name, *read_metadata(name, token, opener)))
    report['clientCredentialsMetadataReady'] = all(s['exists'] and s['enabledVersions'] for s in report['secrets'][:2])
    report['encryptionKeyMetadataReady'] = bool(report['secrets'][2]['enabledVersions'])
    report['limits'] = ['Metadata does not validate credential values or real-company identity.',
                        'No deploy, credential creation, IAM change, database read/write or Intuit call.']
    return report


def main():
    if os.environ.get('GITHUB_REPOSITORY') != 'demac-aruba/demac-corporation' or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError('Run only on reviewed main.')
    try:
        token = subprocess.run(['gcloud', 'auth', 'print-access-token'], check=True, capture_output=True, text=True).stdout.strip()
        if not token:
            raise RuntimeError()
    except Exception:
        raise RuntimeError('Existing cloud identity unavailable.') from None
    report = report_metadata(token, urllib.request.build_opener(NoRedirect))
    print(json.dumps(report, indent=2))
    # A missing third key or not-yet-deployed production function is an expected prerequisite.
    unexpected = [item for item in report['secrets'] + report['functions'] if item['httpStatus'] not in (200, 404)]
    if unexpected or not report['clientCredentialsMetadataReady']:
        raise RuntimeError('Metadata verification incomplete; inspect the sanitized statuses.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('QuickBooks production metadata preflight did not complete successfully.')
        raise SystemExit(1)
