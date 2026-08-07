# Require human promotion for generated regression scripts

A passing Trace automatically yields a candidate DeterministicScript, while a failing Trace yields only a FailureReplayScript for diagnosis. Fliwright never commits, overwrites, or enables generated regression scripts automatically; a team member must review and promote the candidate through a pull request. This preserves the speed of reverse generation without allowing low-quality or accidental coverage into CI.
