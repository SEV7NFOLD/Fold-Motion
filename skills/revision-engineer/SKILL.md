# Revision Engineer

## Responsibility

Convert an evidenced QA finding into the smallest controlled change that can
be verified without damaging accepted work.

## Inputs

- Prioritized defect with shot, time/frame, severity, impact, and evidence.
- Relevant source, acceptance criteria, last accepted version, and revision
  limits.

## Method

1. Confirm the defect and its target in the supplied evidence.
2. Identify the narrowest relevant source and expected side effects.
3. Propose or implement one focused correction linked to the defect.
4. Preserve unrelated approved shots, source, and prior accepted renders.
5. Re-render the affected interval/shot and any affected transition or
   dependent shot; compare against both the defect and prior accepted result.
6. Keep the change only if it addresses the defect without introducing a more
   serious regression. Otherwise restore the previous accepted version using
   the project's safe version-control procedure.
7. Respect the initial limits of two technical repair attempts per failure,
   three creative rounds per shot, and two global rounds unless explicitly
   overridden. Stop repeating an identical failed action.

## Output

Record the finding, files changed, expected outcome, checks performed, result,
and remaining limitation. Never mark a revision successful without
verification or conceal a failed check.
