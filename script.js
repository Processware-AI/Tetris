const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const PREVIEW_BLOCK = 24;

const COLORS = {
  I: "#47d1ff",
  O: "#ffd166",
  T: "#c77dff",
  S: "#5af78e",
  Z: "#ff6b6b",
  J: "#4d7cff",
  L: "#ff9f43",
};

const SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

const SCORE_TABLE = [0, 100, 300, 500, 800];

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nextCtx = nextCanvas.getContext("2d");

const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlay-title");
const overlayTextEl = document.getElementById("overlay-text");
const startButton = document.getElementById("start-button");
const restartButton = document.getElementById("restart-button");

const audioContext = window.AudioContext ? new AudioContext() : null;

const sound = {
  enabled: Boolean(audioContext),
  masterGain: null,
};

canvas.width = COLS * BLOCK;
canvas.height = ROWS * BLOCK;

const state = {
  board: [],
  current: null,
  next: null,
  score: 0,
  lines: 0,
  level: 1,
  dropCounter: 0,
  dropInterval: 1000,
  lastTime: 0,
  running: false,
  gameOver: false,
  paused: false,
  animationFrame: 0,
};

function setupAudio() {
  if (!sound.enabled || sound.masterGain) {
    return;
  }

  sound.masterGain = audioContext.createGain();
  sound.masterGain.gain.value = 0.06;
  sound.masterGain.connect(audioContext.destination);
}

async function unlockAudio() {
  if (!sound.enabled) {
    return;
  }

  setupAudio();
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (_error) {
      sound.enabled = false;
    }
  }
}

function playTone({
  frequency,
  duration = 0.08,
  type = "square",
  volume = 0.18,
  slideTo = null,
  delay = 0,
}) {
  if (!sound.enabled || !sound.masterGain || audioContext.state !== "running") {
    return;
  }

  const start = audioContext.currentTime + delay;
  const end = start + duration;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slideTo) {
    oscillator.frequency.exponentialRampToValueAtTime(slideTo, end);
  }

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(sound.masterGain);
  oscillator.start(start);
  oscillator.stop(end);
}

function playSound(name) {
  switch (name) {
    case "move":
      playTone({ frequency: 220, duration: 0.035, type: "square", volume: 0.07 });
      break;
    case "rotate":
      playTone({ frequency: 330, duration: 0.06, type: "triangle", volume: 0.09, slideTo: 390 });
      break;
    case "softDrop":
      playTone({ frequency: 180, duration: 0.04, type: "sine", volume: 0.06, slideTo: 140 });
      break;
    case "hardDrop":
      playTone({ frequency: 240, duration: 0.06, type: "square", volume: 0.1, slideTo: 110 });
      playTone({ frequency: 140, duration: 0.08, type: "triangle", volume: 0.08, delay: 0.03 });
      break;
    case "lock":
      playTone({ frequency: 160, duration: 0.05, type: "triangle", volume: 0.08 });
      break;
    case "clear":
      playTone({ frequency: 520, duration: 0.08, type: "square", volume: 0.11 });
      playTone({ frequency: 660, duration: 0.09, type: "square", volume: 0.1, delay: 0.07 });
      playTone({ frequency: 880, duration: 0.12, type: "triangle", volume: 0.08, delay: 0.14 });
      break;
    case "gameOver":
      playTone({ frequency: 392, duration: 0.12, type: "sawtooth", volume: 0.08, delay: 0.00 });
      playTone({ frequency: 294, duration: 0.16, type: "sawtooth", volume: 0.08, delay: 0.12 });
      playTone({ frequency: 196, duration: 0.22, type: "sawtooth", volume: 0.08, delay: 0.28 });
      break;
    default:
      break;
  }
}

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function randomPiece() {
  const keys = Object.keys(SHAPES);
  const type = keys[Math.floor(Math.random() * keys.length)];
  return {
    type,
    matrix: SHAPES[type].map((row) => [...row]),
    color: COLORS[type],
    x: Math.floor(COLS / 2) - Math.ceil(SHAPES[type][0].length / 2),
    y: -1,
  };
}

function resetGame() {
  state.board = createBoard();
  state.score = 0;
  state.lines = 0;
  state.level = 1;
  state.dropInterval = 1000;
  state.dropCounter = 0;
  state.lastTime = 0;
  state.gameOver = false;
  state.paused = false;
  state.current = null;
  state.next = randomPiece();
  updateScore();
  hideOverlay();
  spawnPiece();
  draw();
}

function spawnPiece() {
  state.current = state.next || randomPiece();
  state.current.x = Math.floor(COLS / 2) - Math.ceil(state.current.matrix[0].length / 2);
  state.current.y = -1;
  state.next = randomPiece();

  if (collides(state.board, state.current)) {
    endGame();
  }
}

function collides(board, piece) {
  return piece.matrix.some((row, y) =>
    row.some((value, x) => {
      if (!value) {
        return false;
      }

      const newX = piece.x + x;
      const newY = piece.y + y;

      if (newX < 0 || newX >= COLS || newY >= ROWS) {
        return true;
      }

      return newY >= 0 && board[newY][newX] !== 0;
    }),
  );
}

function merge(board, piece) {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value && piece.y + y >= 0) {
        board[piece.y + y][piece.x + x] = piece.color;
      }
    });
  });
}

function rotateMatrix(matrix, dir) {
  const rotated = matrix[0].map((_, index) => matrix.map((row) => row[index]));
  return dir > 0 ? rotated.map((row) => row.reverse()) : rotated.reverse();
}

function rotatePiece(dir) {
  if (!state.running || state.paused || state.gameOver) {
    return;
  }

  const originalX = state.current.x;
  const originalMatrix = state.current.matrix;
  state.current.matrix = rotateMatrix(state.current.matrix, dir);

  let offset = 1;
  while (collides(state.board, state.current)) {
    state.current.x += offset;
    offset = -(offset + (offset > 0 ? 1 : -1));
    if (Math.abs(offset) > state.current.matrix[0].length) {
      state.current.matrix = originalMatrix;
      state.current.x = originalX;
      return;
    }
  }

  draw();
  playSound("rotate");
}

function playerMove(dir) {
  if (!state.running || state.paused || state.gameOver) {
    return;
  }

  state.current.x += dir;
  if (collides(state.board, state.current)) {
    state.current.x -= dir;
  } else {
    draw();
    playSound("move");
  }
}

function hardDrop() {
  if (!state.running || state.paused || state.gameOver) {
    return;
  }

  while (!collides(state.board, state.current)) {
    state.current.y += 1;
  }
  state.current.y -= 1;
  playSound("hardDrop");
  lockPiece();
}

function softDrop() {
  if (!state.running || state.paused || state.gameOver) {
    return;
  }

  state.current.y += 1;
  if (collides(state.board, state.current)) {
    state.current.y -= 1;
    lockPiece();
  } else {
    playSound("softDrop");
  }
  state.dropCounter = 0;
  draw();
}

function lockPiece() {
  merge(state.board, state.current);
  const cleared = clearLines();
  if (cleared === 0) {
    playSound("lock");
  }
  spawnPiece();
  draw();
}

function clearLines() {
  let cleared = 0;

  outer: for (let y = ROWS - 1; y >= 0; y -= 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (state.board[y][x] === 0) {
        continue outer;
      }
    }

    state.board.splice(y, 1);
    state.board.unshift(Array(COLS).fill(0));
    cleared += 1;
    y += 1;
  }

  if (cleared > 0) {
    state.lines += cleared;
    state.score += SCORE_TABLE[cleared] * state.level;
    state.level = Math.floor(state.lines / 10) + 1;
    state.dropInterval = Math.max(180, 1000 - (state.level - 1) * 80);
    updateScore();
    playSound("clear");
  }

  return cleared;
}

function updateScore() {
  scoreEl.textContent = String(state.score);
  linesEl.textContent = String(state.lines);
  levelEl.textContent = String(state.level);
}

function drawCell(context, x, y, color, size) {
  context.fillStyle = color;
  context.fillRect(x * size, y * size, size, size);
  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.lineWidth = 2;
  context.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.strokeRect(x * BLOCK, y * BLOCK, BLOCK, BLOCK);
    }
  }

  state.board.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) {
        drawCell(ctx, x, y, value, BLOCK);
      }
    });
  });
}

function drawGhostPiece() {
  const ghost = {
    ...state.current,
    matrix: state.current.matrix.map((row) => [...row]),
  };

  while (!collides(state.board, ghost)) {
    ghost.y += 1;
  }
  ghost.y -= 1;

  ghost.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value && ghost.y + y >= 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
        ctx.fillRect((ghost.x + x) * BLOCK + 4, (ghost.y + y) * BLOCK + 4, BLOCK - 8, BLOCK - 8);
      }
    });
  });
}

function drawPiece(piece) {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value && piece.y + y >= 0) {
        drawCell(ctx, piece.x + x, piece.y + y, piece.color, BLOCK);
      }
    });
  });
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!state.next) {
    return;
  }

  const matrix = state.next.matrix;
  const offsetX = Math.floor((nextCanvas.width / PREVIEW_BLOCK - matrix[0].length) / 2);
  const offsetY = Math.floor((nextCanvas.height / PREVIEW_BLOCK - matrix.length) / 2);

  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) {
        drawCell(nextCtx, offsetX + x, offsetY + y, state.next.color, PREVIEW_BLOCK);
      }
    });
  });
}

function draw() {
  drawBoard();
  if (state.current && !state.gameOver) {
    drawGhostPiece();
    drawPiece(state.current);
  }
  drawNext();
}

function update(time = 0) {
  if (!state.running) {
    return;
  }

  const delta = time - state.lastTime;
  state.lastTime = time;

  if (!state.paused && !state.gameOver) {
    state.dropCounter += delta;
    if (state.dropCounter > state.dropInterval) {
      softDrop();
    } else {
      draw();
    }
  }

  state.animationFrame = requestAnimationFrame(update);
}

function showOverlay(title, text, buttonText) {
  overlayTitleEl.textContent = title;
  overlayTextEl.textContent = text;
  startButton.textContent = buttonText;
  overlayEl.classList.remove("hidden");
}

function hideOverlay() {
  overlayEl.classList.add("hidden");
}

function startGame() {
  unlockAudio();
  resetGame();
  state.running = true;
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = requestAnimationFrame(update);
}

function togglePause() {
  if (!state.running || state.gameOver) {
    return;
  }

  state.paused = !state.paused;
  if (state.paused) {
    showOverlay("일시정지", "P 키를 다시 눌러 이어서 플레이하세요.", "계속하기");
  } else {
    hideOverlay();
  }
}

function endGame() {
  state.gameOver = true;
  state.running = false;
  cancelAnimationFrame(state.animationFrame);
  playSound("gameOver");
  showOverlay("게임 오버", `최종 점수 ${state.score}점`, "다시 시작");
}

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (key === "p") {
    togglePause();
    return;
  }

  if (!state.running || state.paused || state.gameOver) {
    return;
  }

  if (event.key === "ArrowLeft") {
    playerMove(-1);
  } else if (event.key === "ArrowRight") {
    playerMove(1);
  } else if (event.key === "ArrowDown") {
    softDrop();
  } else if (event.key === "ArrowUp" || key === "x") {
    rotatePiece(1);
  } else if (key === "z") {
    rotatePiece(-1);
  } else if (event.code === "Space") {
    event.preventDefault();
    hardDrop();
  }
});

startButton.addEventListener("click", () => {
  if (state.paused) {
    state.paused = false;
    hideOverlay();
    state.lastTime = performance.now();
    unlockAudio();
    return;
  }

  startGame();
});

restartButton.addEventListener("click", startGame);

showOverlay("Tetris", "시작 버튼을 눌러 게임을 시작하세요.", "게임 시작");
draw();
