import importlib.util
import io
import json
import pathlib
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location('preflight', pathlib.Path(__file__).with_name('quickbooks-production-preflight.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class Opener:
    def __init__(self, body=None, status=200):
        self.body = json.dumps(body or {}).encode()
        self.status = status
        self.requests = []

    def open(self, req, timeout):
        self.requests.append(req)
        if self.status != 200:
            raise urllib.error.HTTPError(req.full_url, self.status, 'redacted', {}, None)
        return io.BytesIO(self.body)


class PreflightTests(unittest.TestCase):
    def test_only_fixed_metadata_gets(self):
        opener = Opener()
        p.report_metadata('synthetic-auth', opener)
        self.assertEqual(len(opener.requests), 5)
        for req in opener.requests:
            self.assertEqual(req.get_method(), 'GET')
            self.assertIn(req.full_url, p.ENDPOINTS.values())
            self.assertNotIn(':access', req.full_url)
            self.assertIsNone(req.data)
        with self.assertRaises(KeyError):
            p.read_metadata('https://example.com', 'synthetic-auth', opener)
        self.assertIsNone(p.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.com'))

    def test_secret_output_never_echoes_payload_or_wrong_identity(self):
        name = p.SECRETS[0]
        raw = {'payload': {'data': 'SENSITIVE-SYNTHETIC'}, 'versions': [
            {'name': f'projects/1053571783393/secrets/{name}/versions/1', 'state': 'ENABLED', 'value': 'SENSITIVE-SYNTHETIC'},
            {'name': 'projects/other/secrets/unrelated/versions/2', 'state': 'ENABLED'},
            {'name': f'projects/999999/secrets/{name}/versions/9', 'state': 'ENABLED'},
            {'name': f'projects/{p.PROJECT}/secrets/{name}/versions/3', 'state': 'DISABLED'}]}
        result = p.secret_metadata(name, 200, raw)
        self.assertEqual(result['enabledVersions'], ['1'])
        self.assertNotIn('SENSITIVE-SYNTHETIC', json.dumps(result))

    def test_function_metadata_excludes_environment_and_secret_values(self):
        raw = {'name': f'projects/{p.PROJECT}/locations/us-central1/functions/quickbooksConnection', 'state': 'ACTIVE',
               'buildConfig': {'runtime': 'nodejs22', 'entryPoint': 'quickbooksConnection'},
               'serviceConfig': {'revision': 'quickbooksconnection-00001-test',
                                 'environmentVariables': {'QBO_PRODUCTION_CLIENT_SECRET': 'SENSITIVE-SYNTHETIC', 'QBO_PRODUCTION_ENABLED': 'false'}}}
        result = p.function_metadata('quickbooksConnection', 200, raw)
        self.assertTrue(result['active'])
        self.assertFalse(result['productionEnabled'])
        self.assertNotIn('SENSITIVE-SYNTHETIC', json.dumps(result))
        raw['name'] = 'projects/wrong/locations/us-central1/functions/quickbooksConnection'
        self.assertEqual(p.function_metadata('quickbooksConnection', 200, raw)['httpStatus'], 502)

    def test_missing_forbidden_redirect_malformed_and_oversized_fail_closed(self):
        for status in (403, 404, 302):
            self.assertEqual(p.read_metadata(p.SECRETS[0], 'synthetic', Opener(status=status)), (status, None))
        for body in (b'not-json', b'x' * 65537, b'[]'):
            opener = Opener()
            opener.body = body
            self.assertEqual(p.read_metadata(p.SECRETS[0], 'synthetic', opener), (502, None))


if __name__ == '__main__':
    unittest.main()
