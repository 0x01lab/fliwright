# Fail closed when test planning is incomplete

Natural-language TestRequests are executed only after the Planner emits a valid TestPlan with required steps, assertions, target capabilities, and SideEffectAuthorization. Missing or ambiguous information places the request in NeedsInput instead of allowing the planner to guess and run. This preserves trustworthy results and lets a submitter resume the same request after supplying the missing information.
