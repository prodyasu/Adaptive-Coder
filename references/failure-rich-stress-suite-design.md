# Failure-Rich Reasoning Stress Suite
## Design Document — t_1e69c089

---

## 1. Problem Statement

The current N=8 benchmark is **too easy** for `minimax-m2.7:cloud`. R3 efficacy data shows:

| Baseline | pass@1 | cohAtrRisk |
|----------|--------|------------|
| `gen18_evolved` | 82-87% | 0% |
| `reasoning_os_v0` | 82-87% | 0% |
| Held-out (held-out test suites) | 100% for all 8 problems | 0% |

Both baselines consistently score **80-100% first-attempt** on all N=8 problems. This means:
- The benchmark detects **protocol/debug failures** (extraction, signature), not **reasoning failures**
- Interventions like repair/decomposition cannot be measured — there are too few failures to distinguish improvement from noise
- cohAtrRisk is always 0% because held-out tests are no harder than primary tests

**Goal**: Create a small curated slice (4-6 problems) where baselines score **40-70% first-attempt**, producing enough failures for repair/decomposition interventions to matter.

---

## 2. Selection Criteria for Stress-Suite Problems

### 2.1 Hardness Requirements

| Criterion | Target | Rationale |
|-----------|--------|-----------|
| Baseline pass@1 | **40-70%** | Enough failures (30-60%) to measure repair/decomposition lift |
| Visible test underdetermination | **≥1 wrong algorithm passes visible tests** | Detects brittle "pattern-match to scaffold" behavior |
| Held-out discriminativity | **≥2 held-out tests fail a shallow solution** | Detects COH_ATR contamination |
| State/invariant reasoning | **Required, not pattern matching** | Must require actual algorithmic reasoning |

### 2.2 Failure Mode Coverage

Each problem must target at least one specific **reasoning failure mode**:

| Failure Mode | Description | Detection Method |
|--------------|-------------|------------------|
| **State tracking** | Forgets mutable state across iterations | Tests with ordering sensitivity |
| **Invariant maintenance** | Violates loop/recursion invariant | Tests that expose base-case edge cases |
| **Backtracking failure** | Doesn't explore all valid paths | Tests requiring exhaustive enumeration |
| **Boundary confusion** | Off-by-one errors in index/range logic | Edge-case inputs at limits |
| **Greedy bias** | Assumes local optimum = global optimum | Counter-examples to greedy choice |
| **Ambigious spec** | Unclear what correct behavior is | Multiple valid interpretations |

### 2.3 Anti-Patterns (Why Current N=8 Fails)

The N=8 problems fail as discriminating benchmarks because:

| Problem | Pass@1 | Why It's Easy |
|---------|--------|---------------|
| binary-search | 80-100% | Signature clarity, deterministic bounds |
| climbing-stairs | 40-80% | Fibonacci pattern is obvious from examples |
| container-with-most-water | 80-100% | Two-pointer intuition is scaffold-provided |
| coin-change-ii | 0-80% | High variance, but DP pattern is scaffolded by problem name |
| two-sum | 80-100% | Hash-map is the canonical solution |
| valid-palindrome | 80-100% | Two-pointer is scaffolded by problem statement |
| number-of-islands | 60-100% | DFS/BFS pattern is scaffolded |
| invert-binary-tree | 80-100% | Tree swap is trivial recursive pattern |

**Core issue**: The N=8 problems' visible tests fully determine the algorithm. A model that pattern-matches to the problem name will always solve them. There is no hidden complexity requiring reasoning.

---

## 3. Candidate Problems

### 3.1 Problem Category: Harder DP Variants

These require actual subproblem identification and are NOT scaffolded by problem name alone.

---

#### P1: `edit-distance` (Levenshtein Distance)

**Pattern**: DP with two-dimensional state

**Signature**: `def minDistance(word1: str, word2: str) -> int:`

**Why it's harder than current N=8**:
- Two mutable dimensions (i, j) — state tracking is complex
- Requires understanding that `dp[i][j]` = min cost to convert `word1[0:i]` to `word2[0:j]`
- Base case `dp[0][j] = j` and `dp[i][0] = i` requires invariant reasoning
- Recurrence has 3 options (delete/substitute/insert), not 1

**Primary visible tests**:
```python
assert minDistance("horse", "ros") == 3   # horse→rorse (3 edits)
assert minDistance("intention", "execution") == 5
assert minDistance("", "abc") == 3
assert minDistance("abc", "") == 3
```

**Shallow solution that passes visible but fails held-out**:
```python
def minDistance(word1, word2):
    # Greedy: delete all from word1, insert all from word2
    return len(word1) + len(word2)  # Wrong! Passes empty-string tests
```
Visible tests: `minDistance("", "abc")==3` ✓, `minDistance("abc", "")==3` ✓
Held-out: `minDistance("horse", "ros")==3` → gives 10, not 3

**Held-out tests**:
```python
assert minDistance("food", "money") == 4  # NOT len(word1)+len(word2)
assert minDistance("aaa", "ab") == 2
assert minDistance("pneumonia", "neumonia") == 1  # delete first 'p'
assert minDistance("abcdef", "azced") == 3  # substitution pattern
```

**Expected failure distribution**:
- Logic (off-by-one in base case): 50%
- Timeout (O(n²) without optimization): 10%
- Format (extraction contamination): 30%
- Correct: 10%

---

#### P2: `longest-increasing-subsequence`

**Pattern**: DP with O(n²) or patience-sorting O(n log n)

**Signature**: `def lengthOfLIS(nums: List[int]) -> int:`

**Why it's harder than current N=8**:
- Not a classic DP naming pattern — "longest-increasing-subsequence" is less scaffolded than "coin-change-ii"
- Requires understanding that LIS is NOT the same as "longest contiguous subarray"
- The patience-sorting approach requires non-obvious binary search insight
- Greedy+二分 is the optimal solution, but O(n²) also passes

**Primary visible tests**:
```python
assert lengthOfLIS([10,9,2,5,3,7,101,18]) == 4  # [2,3,7,101]
assert lengthOfLIS([0,1,0,3,2,3]) == 4
assert lengthOfLIS([1,1,1]) == 1
```

**Shallow solution that passes visible but fails held-out**:
```python
def lengthOfLIS(nums):
    # Wrong: assumes LIS is longest contiguous increasing run
    if not nums: return 0
    longest = 1
    current = 1
    for i in range(1, len(nums)):
        if nums[i] > nums[i-1]:
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest  # Fails [10,9,2,5,3,7,101,18] → returns 4 but correct is 4 (lucky)
                   # Actually this specific case works, but fails [0,1,0,3,2,3] → returns 4, correct is 4 (lucky)
                   # Need a harder counterexample:
                   # [1,3,6,7,5,4,8,9] → greedy finds [1,3,6,7,8,9]=6, correct is [1,3,5,8,9]=5 but wait...
                   # Actually the greedy for this is wrong in a different way
```

A better shallow fails:
```python
def lengthOfLIS(nums):
    # Always picks the first increasing element, not the globally optimal
    if not nums: return 0
    dp = [1] * len(nums)
    for i in range(1, len(nums)):
        for j in range(i):
            if nums[j] < nums[i]:
                dp[i] = max(dp[i], dp[j] + 1)  # O(n²) DP, correct
    return max(dp) if dp else 0
```
This DP is actually correct! Need a truly wrong algorithm:
```python
def lengthOfLIS(nums):
    # Assumes LIS must include first element
    if not nums: return 0
    count = 1
    for i in range(1, len(nums)):
        if nums[i] > nums[0]:
            count += 1
    return count  # Fails [1,3,2,4] → returns 2, correct is 3
```

**Held-out tests**:
```python
assert lengthOfLIS([1,3,6,7,5,4,8,9]) == 5  # [1,3,5,8,9] not [1,3,6,7,8,9]
assert lengthOfLIS([5,4,3,2,1]) == 1
assert lengthOfLIS([3,1,4,1,5,9,2,6,5]) == 4  # [1,4,5,9] or [1,2,6]
assert lengthOfLIS([1,2,3,4,5]) == 5  # strictly increasing
```

**Expected failure distribution**:
- Logic (greedy instead of DP): 40%
- Format: 30%
- Timeout: 5%
- Correct: 25%

---

#### P3: `word-break` (DP with string partition)

**Pattern**: Unbounded DP + string handling

**Signature**: `def wordBreak(s: str, wordDict: List[str]) -> bool:`

**Why it's harder than current N=8**:
- Combines two hard operations: substring extraction + DP state
- Multiple valid segmentations exist; must find if ANY valid path exists
- Naive recursion is exponential; DP is O(n²)
- The "obvious" recursive approach fails due to overlapping subproblems

**Primary visible tests**:
```python
assert wordBreak("leetcode", ["leet","code"]) == True
assert wordBreak("applepenapple", ["apple","pen"]) == True
assert wordBreak("catsandog", ["cats","and","og"]) == False
```

**Shallow solution that passes visible but fails held-out**:
```python
def wordBreak(s, wordDict):
    # Greedy: take longest prefix that matches
    i = 0
    while i < len(s):
        matched = False
        for word in sorted(wordDict, key=len, reverse=True):  # longest first
            if s[i:].startswith(word):
                i += len(word)
                matched = True
                break
        if not matched:
            return False
    return True  # "dogs" with ["dog"] → "dog"+"s" fails, but greedy finds "dog" and stops
# Actually this works for some cases but fails "aaaaaaa" with ["aaa","aaaa"]
# Greedy takes "aaaa" first, leaves "aaa", matches, returns True
# But "aaaaaaa" with ["aaa","aaaa","aaaaa"] → greedy: "aaaaa"+"aa" fails → False
# But actual: "aaa"+"aaa"+"a" → True if "a" in dict... let me use different example
```

A truly wrong algorithm:
```python
def wordBreak(s, wordDict):
    # Only checks if ALL words can be formed, not if they tile the string
    return all(word in wordDict for word in s.split('o'))  # obviously wrong
```

Better wrong algorithm:
```python
def wordBreak(s, wordDict):
    # Assumes suffix must always match (wrong direction)
    i = len(s)
    while i > 0:
        matched = False
        for word in wordDict:
            if s[i-len(word):i] == word:
                i -= len(word)
                matched = True
                break
        if not matched:
            return False
    return True  # "leetcode" with ["leet","code"] → reverse check, works
              # But "applepenapple" with ["apple","pen"] → reverse: "apple"@"penapple" fails
```

**Held-out tests**:
```python
assert wordBreak("aaaaaaa", ["aaaa","aaa"]) == True   # multiple ways to segment
assert wordBreak("ab", ["a","b","c"]) == False         # "ab" not in dict
assert wordBreak("pineapple", ["pine","apple","pen"]) == False  # wrong segmentation
assert wordBreak("goals", ["go","al","als","goal","goals"]) == True  # multiple valid segmentations
```

---

### 3.2 Problem Category: Graph Traversal with Edge-Case Traps

---

#### P4: `detect-cycle` (Linked List)

**Pattern**: Floyd's cycle detection OR hash-set approach

**Signature**: `def hasCycle(head: Optional[ListNode]) -> bool:`

**Why it's harder than current N=8**:
- Requires understanding of pointer manipulation + cycle detection invariant
- Floyd's algorithm requires non-obvious mathematical insight (tortoise-hare)
- Hash-set is simpler but uses O(n) memory
- Edge cases: null head, single node cycle, two-cycle

**Primary visible tests**:
```python
# cycle at position 1: 3->2->0->4->2
assert hasCycle(buildCycle([3,2,0,4], 1)) == True
assert hasCycle(None) == False  # null head
assert hasCycle(buildCycle([1], -1)) == False  # single node, no cycle
```

**Shallow solution that passes visible but fails held-out**:
```python
def hasCycle(head):
    # Counts visits; wrong if same node appears twice but not a cycle
    visited = set()
    curr = head
    while curr:
        if curr in visited:
            return True
        visited.add(curr)
        curr = curr.next
    return False  # This is actually correct for cycle detection
                 # Need a wrong one: assumes cycle is at head
```

Wrong algorithm:
```python
def hasCycle(head):
    # Assumes cycle is always at head position
    if not head or not head.next:
        return False
    return head == head.next.next  # Only detects head self-loop
```

**Held-out tests**:
```python
# Two-node cycle
assert hasCycle(buildCycle([1,2], 0)) == True  # 1->2->1 cycle
# Tail points to middle
# 1->2->3->4->2 (tail points to node 2)
assert hasCycle(buildCycle([1,2,3,4], 1)) == True  # 4->2 cycle
# Very long list with late cycle
n = 1000
head = buildRange(n)
getNode(head, n-1).next = getNode(head, 500)  # cycle at position 500
assert hasCycle(head) == True
```

---

#### P5: `critical-connections` (Bridges in Graph)

**Pattern**: Graph traversal with DFS + discovery time comparison

**Signature**: `def criticalConnections(n: int, connections: List[List[int]]) -> List[List[int]]:`

**Why it's harder than current N=8**:
- Requires understanding of graph theory concept "bridge"
- Tarjan's algorithm or DFS with timing
- Not scaffolded by problem name — "critical connections" is not a known pattern
- Edge cases: disconnected components, multiple edges between same nodes

**Primary visible tests**:
```python
assert criticalConnections(4, [[0,1],[1,2],[2,0],[1,3]]) == [[1,3]]
# Remove [1,3] → graph disconnects into two components
assert criticalConnections(2, [[0,1]]) == [[0,1]]
```

**Shallow solution that passes visible but fails held-out**:
```python
def criticalConnections(n, connections):
    # Remove one edge at a time, BFS to check connectivity
    # Wrong: doesn't handle disconnected components
    result = []
    for i in range(len(connections)):
        removed = connections[:i] + connections[i+1:]
        # BFS from 0 to check if all nodes reachable
        # but doesn't handle case where node 0 is isolated from others
        if not isConnected(removed, n):
            result.append(connections[i])
    return result
```

**Held-out tests**:
```python
# Disconnected components: no single edge removal disconnects any component
assert criticalConnections(5, [[0,1],[2,3],[3,4],[4,2]]) == [[2,3],[3,4],[4,2]]
# Single isolated node
assert criticalConnections(3, [[0,1]]) == [[0,1]]  # node 2 is isolated
# Multiple edges between same nodes (if handling duplicates)
# Linear chain: 0-1-2-3
assert criticalConnections(4, [[0,1],[1,2],[2,3]]) == [[0,1],[1,2],[2,3]]  # all are bridges
```

---

### 3.3 Problem Category: Nested Data Transforms

---

#### P6: `flatten-nested-list` (Depth-Constrained)

**Pattern**: Recursive traversal with depth tracking

**Signature**: `def flatten(nestedList: List[Union[int, List]]) -> List[int]:`

**Why it's harder than current N=8**:
- Data structure is self-referential (nested lists to any depth)
- Must handle arbitrary nesting depth
- Cannot use simple recursion depth limit — need to handle arbitrarily deep nesting
- Different from number-of-islands (which is grid-based, not nested lists)

**Primary visible tests**:
```python
assert flatten([[1,2], 3, [4,5]]) == [1,2,3,4,5]
assert flatten([1, [2, [3, [4]]]]) == [1,2,3,4]
assert flatten([]) == []
```

**Shallow solution that passes visible but fails held-out**:
```python
def flatten(nestedList):
    result = []
    def rec(lst, depth=0):
        for item in lst:
            if isinstance(item, int):
                result.append(item)
            else:
                rec(item)  # No depth limit check — fails on [[[[[1]]]]]
    rec(nestedList)
    return result
```

**Held-out tests**:
```python
# Deep nesting without depth limit — recursion depth exceeded
deep = nestedlist(10)  # 10 levels of nesting
assert flatten(deep) == list(range(1, 11))
# Mixed depth
assert flatten([1, [2, [3]], 4]) == [1, 2, 3, 4]
# Empty nested lists
assert flatten([1, [], 2]) == [1, 2]
```

---

### 3.4 Problem Category: Multi-Step Constraint Validation

---

#### P7: `valid-sudoku` (9x9 Board Validation)

**Pattern**: Multi-constraint validation (rows, cols, boxes)

**Signature**: `def isValidSudoku(board: List[List[str]]) -> bool:`

**Why it's harder than current N=8**:
- Must check three distinct constraint types simultaneously
- 3x3 subgrid index calculation is non-obvious
- Requires understanding of what "valid" means (no duplicates in row/col/box)
- Not scaffolded by typical algorithm problem patterns

**Primary visible tests**:
```python
board1 = [
    ["5","3",".",".","7",".",".",".","."],
    ["6",".",".","1","9","5",".",".","."],
    [".","9","8",".",".",".",".","6","."],
    ["8",".",".",".","6",".",".",".","3"],
    ["4",".",".","8",".","3",".",".","1"],
    ["7",".",".",".","2",".",".",".","6"],
    [".","6",".",".",".",".","2","8","."],
    [".",".",".","4","1","9",".",".","5"],
    [".",".",".",".","8",".",".","7","9"]
]
assert isValidSudoku(board1) == True
```

**Shallow solution that passes visible but fails held-out**:
```python
def isValidSudoku(board):
    # Only checks rows
    for row in board:
        digits = [c for c in row if c != '.']
        if len(digits) != len(set(digits)):
            return False
    return True  # Misses column and box violations
```

**Held-out tests**:
```python
# Column duplicate
col_dup = [[".","1",".",".",".",".",".",".","."],
           [".","2",".",".",".",".",".",".","."],
           [".","3",".",".",".",".",".",".","."],
           [".","4",".",".",".",".",".",".","."],
           [".","5",".",".",".",".",".",".","."],
           [".","6",".",".",".",".",".",".","."],
           [".","7",".",".",".",".",".",".","."],
           [".","8",".",".",".",".",".",".","."],
           [".","9",".",".",".",".",".",".","."]]  # Actually valid columns
# Actually need column with duplicate:
col_dup[0][1] = "1"
col_dup[2][1] = "1"  # duplicate '1' in column 1
assert isValidSudoku(col_dup) == False

# Box duplicate (3x3 subgrid)
box_dup = [[".",".",".",".",".",".",".",".","."],
           [".",".",".",".",".",".",".",".","."],
           [".",".",".",".",".",".",".",".","."],
           [".",".",".","1",".",".",".",".","."],
           [".",".",".",".",".",".",".",".","."],
           [".",".",".",".",".",".",".",".","."],
           [".",".",".",".",".",".","1",".","."],
           [".",".",".",".",".",".",".",".","."],
           [".",".",".",".",".",".",".",".","."]]  # duplicate '1' in box (3,0)-(5,2)
assert isValidSudoku(box_dup) == False

# Valid but with more rows
valid_board = [
    ["8","3",".",".","7",".",".",".","."],
    ["6",".",".","1","9","5",".",".","."],
    [".","9","8",".",".",".",".","6","."],
    ["8",".",".",".","6",".",".",".","3"],
    ["4",".",".","8",".","3",".",".","1"],
    ["7",".",".",".","2",".",".",".","6"],
    [".","6",".",".",".",".","2","8","."],
    [".",".",".","4","1","9",".",".","5"],
    [".",".",".",".","8",".",".","7","9"]
]
assert isValidSudoku(valid_board) == True
```

---

## 4. Held-Out Test Design Principles

Following COH_ATR discipline from `held-out-test-suites.js`:

### 4.1 Difficulty Calibration

- Held-out tests must be **same difficulty** as primary tests, not harder
- If primary tests pass at 60%, held-out tests should also pass at ~60% for a correct solution
- A correct reference solution must pass both primary AND held-out at equivalent rates

### 4.2 Reference Validation

Before adding a stress-suite problem, validate:
1. Write reference solution
2. Run against primary tests → must pass 100%
3. Run against held-out tests → must pass 100%
4. If reference fails held-out, the held-out is incorrectly designed (too hard)

### 4.3 Underdetermination Requirement

Visible tests must NOT fully determine the correct algorithm:
- **Necessary condition**: There exists a wrong algorithm that passes all visible tests
- **Verification method**: Manually construct a wrong algorithm and confirm it passes visible tests but fails held-out tests

This is the key discriminating feature that current N=8 lacks.

### 4.4 No Confounds

Held-out tests must not introduce:
- Additional algorithmic complexity beyond what primary tests measure
- Edge cases that require special handling not related to the problem's core reasoning
- Time limits or memory constraints (handled separately)

---

## 5. Integration Plan

### 5.1 Directory Structure

New problems go into `testcases-expansion/` (already supported by `findProblemDir`):

```
testcases-expansion/
  edit-distance/
    task.txt
    reference.ts
  longest-increasing-subsequence/
    task.txt
    reference.ts
  word-break/
    task.txt
    reference.ts
  detect-cycle/
    task.txt
    reference.ts
  critical-connections/
    task.txt
    reference.ts
  flatten-nested-list/
    task.txt
    reference.ts
  valid-sudoku/
    task.txt
    reference.ts
```

### 5.2 Wiring into `eval.js`

The `testSuites` object in `eval.js` (lines 744-788) must be extended with primary test cases for each new problem.

**Pattern for adding new problem**:
```javascript
"edit-distance": [
  `from edit_distance import ${fnName} as f; assert f("horse", "ros") == 3`,
  // ... additional visible tests
],
```

### 5.3 Runner Scripts

Following the pattern of `run-r3-efficacy.mjs` and `run-r3-capability.mjs`:

```
run-stress-sieve.mjs        # Run N=8 stress suite, k=5, report pass@1
calibrate-stress-heldout.mjs # Validate reference solutions pass held-out at ~same rate
```

### 5.4 Validation Protocol

1. **Reference calibration** (per problem):
   ```bash
   node calibrate-stress-heldout.mjs --problem=edit-distance
   ```
   Expected: reference passes 100% on primary AND held-out

2. **Baseline evaluation**:
   ```bash
   node run-stress-sieve.mjs --baseline=gen18 --k=5
   node run-stress-sieve.mjs --baseline=reasoning_os_v0 --k=5
   ```
   Expected: both baselines at 40-70% first-attempt on stress-suite problems

3. **CohAtrRisk measurement**:
   - cohAtrRisk > 0 indicates shallow solution detected
   - cohAtrRisk = 0 indicates benchmark still too easy

---

## 6. Summary: Target Problems

| ID | Problem | Pattern | Target pass@1 | Primary Failure Mode |
|----|---------|---------|---------------|----------------------|
| P1 | `edit-distance` | DP 2D | 40-60% | Base case + recurrence complexity |
| P2 | `longest-increasing-subsequence` | DP or greedy | 45-65% | Greedy bias / DP recurrence |
| P3 | `word-break` | DP + string | 35-55% | Overlapping subproblems / recursion |
| P4 | `detect-cycle` | Floyd/two-pointer | 50-70% | Invariant understanding |
| P5 | `critical-connections` | Graph DFS + timing | 40-60% | Discovery time concept |
| P6 | `flatten-nested-list` | Recursive traversal | 50-70% | Depth tracking |
| P7 | `valid-sudoku` | Multi-constraint validation | 45-65% | Three constraint types |

**Phase 1 (recommended)**: Implement P1, P3, P5, P7 — four problems spanning DP, graph, and multi-constraint categories.

**Phase 2**: Add P2, P4, P6 if Phase 1 proves discriminative.

---

## 7. Design Rationale

### Why 4-6 Problems (Not 20)

- Statistical power at N=4-6 with k=5 is sufficient for Wilson CI widths of ~25-30pp
- Quality of discrimination matters more than quantity
- Each problem must be carefully validated (reference calibration, wrong-algorithm construction)
- Adding problems without proper validation is noise, not signal

### Why These Categories

| Category | Why it catches reasoning failures |
|----------|-----------------------------------|
| Harder DP variants | Subproblem identification is not scaffolded by problem name; state tracking across dimensions |
| Graph traversal | Cycle detection and bridge finding require invariant reasoning, not pattern matching |
| Nested data transforms | Self-referential data structures expose depth-tracking failures |
| Multi-step constraints | Validating multiple constraint types simultaneously exposes partial-solution bias |

### Why Current N=8 Fails the Discrimination Test

The N=8 problems all have **visible test suites that fully determine the algorithm**. A model that pattern-matches to "two-sum → hash map", "binary-search → binary search" will solve them without reasoning. The stress-suite problems are designed so that **visible tests underdetermine the solution** — multiple algorithms pass visible tests, but only one is correct, and held-out tests distinguish them.