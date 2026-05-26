export function isValidSudoku(board: string[][]): boolean {
  for (let i = 0; i < 9; i++) {
    const row = new Set<string>();
    const col = new Set<string>();
    const box = new Set<string>();
    for (let j = 0; j < 9; j++) {
      if (board[i][j] !== '.') {
        if (row.has(board[i][j])) return false;
        row.add(board[i][j]);
      }
      if (board[j][i] !== '.') {
        if (col.has(board[j][i])) return false;
        col.add(board[j][i]);
      }
      const boxRow = Math.floor(i / 3) * 3 + Math.floor(j / 3);
      const boxCol = (i % 3) * 3 + (j % 3);
      if (board[boxRow][boxCol] !== '.') {
        if (box.has(board[boxRow][boxCol])) return false;
        box.add(board[boxRow][boxCol]);
      }
    }
  }
  return true;
}