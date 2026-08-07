# Run queued E2E work on team-operated workers

TeamTestQueue work runs on registered, team-operated ExecutionWorkers rather than a containerized device farm or third-party device cloud. The first worker is the team's dedicated Mac mini, using configured simulators and Flutter builds. This preserves iOS access and minimizes the operational surface while the managed-execution workflow is proven.
