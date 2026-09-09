import importlib.util
from pathlib import Path
import unittest
s = importlib.util.spec_from_file_location('deployment', Path(__file__).with_name('deploy-careers-admin.py'))
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
class AdminRelease(unittest.TestCase):
    def test_fail_closed_environment(self):
        e=m.release_environment({'projectId':m.PROJECT,'storageBucket':'verified-test-bucket'})
        self.assertEqual(e['DEMAC_CAREERS_BACKEND_ENABLED'],'true')
        self.assertEqual(e['CAREERS_RELEASE_APPROVED'],'false'); self.assertEqual(e['CAREERS_RETENTION_APPROVED'],'false')
        self.assertNotIn('CAREERS_SMTP_PASSWORD',e); self.assertNotIn('*',e['CAREERS_ALLOWED_ORIGINS'])
    def test_reject_wrong_project(self):
        with self.assertRaises(ValueError):m.release_environment({'projectId':'another-project','storageBucket':'test'})
    def test_reject_missing_bucket(self):
        with self.assertRaises(ValueError):m.release_environment({'projectId':m.PROJECT})
    def test_refuse_to_overwrite_activated_runtime(self):
        for flag in ['CAREERS_RELEASE_APPROVED','CAREERS_RETENTION_APPROVED']:
            with self.assertRaises(RuntimeError):m.assert_not_live({'serviceConfig':{'environmentVariables':{flag:'true'}}})
        m.assert_not_live({})
if __name__=='__main__':unittest.main()
