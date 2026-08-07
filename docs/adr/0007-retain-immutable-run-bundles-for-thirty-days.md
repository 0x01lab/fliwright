# Retain immutable run bundles for thirty days

Every completed or failed TestPlan execution produces an immutable RunBundle containing the request, normalized plan, application revision, execution metadata, Trace, assertions, diagnostics, screenshots, and generated scripts. The first TeamTestQueue retains RunBundles for 30 days by default, with team-level configuration; DeterministicScripts promoted to source control are not governed by this retention policy.
