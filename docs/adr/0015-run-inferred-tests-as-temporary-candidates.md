# Run inferred tests as temporary candidates

DevAssistCycle automatically writes and runs a GeneratedTestCandidate under `.fliwright/generated/` for an eligible natural-language DevAssistRequest when TestIntentInference can use SupportedAssertions. The candidate, its inference evidence, and its results return to the external coding agent, which alone decides whether to promote it into the project's formal test suite. Non-assertable proposals require review and are not executed.
