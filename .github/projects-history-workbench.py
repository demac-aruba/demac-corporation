"""Exact-source publication helper for a disposable workbench; absent from the proposed tree.
Never moves a branch, deploys, imports data, or accesses runtime credentials.
"""
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

BASE = '7d25301ad639b23a8b4d71213026d76ef55b0613'
REPO = 'demac-aruba/demac-corporation'
BRANCH = 'refs/heads/chore/projects-history-materials-validation'
EXPECTED = json.loads(Path('.github/projects-history-source-hashes.json').read_text())
def blob(path):
    return subprocess.check_output(['git','hash-object',path], text=True).strip()
def verify():
    for path, expected in EXPECTED.items():
        actual = blob(path)
        if actual != expected: raise RuntimeError('Unexpected final source: '+path+' '+actual+' != '+expected)
if os.environ.get('GITHUB_REPOSITORY') != REPO or os.environ.get('GITHUB_REF') != BRANCH:
    raise RuntimeError('This helper runs only in the isolated history/materials workbench.')
if sys.argv[1] == 'apply':
    for path, (before, edits) in json.loads(Path('.github/projects-history-source-edits.json').read_text()).items():
        if blob(path) != before: raise RuntimeError('Refusing another source base: '+path)
        lines = Path(path).read_text().splitlines(keepends=True)
        for start,end,value in reversed(edits): lines[start:end] = value.splitlines(keepends=True)
        Path(path).write_text(''.join(lines))
    verify()
    subprocess.run(['git','diff','--check'],check=True)
    print('Verified all 15 exact implementation blobs; no runtime transformation will ship.')
elif sys.argv[1] == 'propose':
    verify()
    def api(path,data=None):
        req=urllib.request.Request('https://api.github.com/repos/'+REPO+path,
            data=None if data is None else json.dumps(data).encode(),
            headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','Content-Type':'application/json'},
            method='GET' if data is None else 'POST')
        with urllib.request.urlopen(req,timeout=60) as res: return json.load(res)
    if api('/git/ref/heads/feature/projects-canonical-integration')['object']['sha'] != BASE:
        raise RuntimeError('Feature head changed. Refusing to overwrite unrelated work.')
    baseTree=api('/git/commits/'+BASE)['tree']['sha']
    entries=[]
    for path,expected in EXPECTED.items():
        made=api('/git/blobs',{'content':Path(path).read_text(),'encoding':'utf-8'})
        if made['sha']!=expected: raise RuntimeError('Published blob mismatch: '+path)
        entries.append({'path':path,'mode':'100644','type':'blob','sha':expected})
    entries.append({'path':'.github/workflows/projects-current-source-checkpoint.yml','mode':'100644','type':'blob','sha':None})
    tree=api('/git/trees',{'base_tree':baseTree,'tree':entries})
    commit=api('/git/commits',{'message':'feat(projects): reconcile imported scheduling references and read canonical Inventory issues\n\nReuse owner authorization, exact source identities, optimistic versions, atomic audit and receipts. Preserve primary/support Work Orders and original archives; no fabricated costs, person-hours or backup claims. No production activation, migration or main merge.', 'tree':tree['sha'],'parents':[BASE]})
    Path('projects-history-proposed.json').write_text(json.dumps({'proposedCommit':commit['sha'],'base':BASE,'tree':tree['sha'],'sourceBlobs':EXPECTED,'refMoved':False,'productionAccessed':False},indent=2))
    print('PROPOSED_COMMIT='+commit['sha'])
else: raise RuntimeError('Unsupported workbench command.')
