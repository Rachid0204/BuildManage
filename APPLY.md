# Applying and reviewing this repair branch

Review the code changes and LOCAL_FIX_NOTES.md against base commit 7600bb68b0f6798e7bf38d25c9b94cf3d98227b1.

The batch repairs the verified authorization and payment failures. It does not close all original audit findings or certify production deployment.

From the branch checkout:

```bash
npm ci
npm run check:local
```

The local checks require no production integration credentials. They create disposable synthetic data, block external calls and do not deploy.

When using a patch export on the exact base commit:

```bash
git switch -c fix/authorization-and-payment-boundaries
git apply --check /path/to/BuildManage_Authorization_Payment_Fixes.patch
git apply /path/to/BuildManage_Authorization_Payment_Fixes.patch
npm ci
npm run check:local
```

Recheck patch applicability if main has moved. Resolve source conflicts deliberately and rerun the affected tests. Publishing or merging must report the actual remote branch/commit; a local commit alone is not a GitHub update.
