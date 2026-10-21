# Production-readiness changes

The earlier snapshot/mirror architecture has been replaced by explicit backend operations and durable transactions. See README.md for behavior and DEPLOYMENT.md for migration, staging acceptance, backup and remaining live configuration gates. Do not use an old rollout procedure with the new deny-all browser rules.
