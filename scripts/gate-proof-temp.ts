// Temporary file to exercise the dual-AI review gate after the drizzle-orm
// dedupe rebuild. Safe to delete. See gate proof in the build-fix task.
export function addNumbers(a: number, b: number): number {
  // Intentionally trivial; reviewers should find nothing alarming here.
  var result = a + b;
  return result;
}
