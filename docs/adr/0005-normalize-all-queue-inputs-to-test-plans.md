# Normalize all queue inputs to TestPlans

The TeamTestQueue accepts natural-language requirements, structured TestPlans, and existing DeterministicScripts, but execution always starts from a normalized TestPlan bound to an ApplicationTarget. This gives prompt-driven requests a common validation and authorization boundary while preserving deterministic script replay for regression runs.
