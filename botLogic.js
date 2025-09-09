// Bot AI logic and movement functions
import { validateCombination, canBeatCombination, getValidMoves } from './gameLogic.js';

// Bot AI logic
function makeBotMove(room, bot, io) {
  // Get valid moves for the bot
  const validMoves = getValidMoves(bot.hand, room.currentCombination);

  if (validMoves.length === 0) {
    // No valid moves, bot must pass
    setTimeout(() => {
      handleBotPass(room, bot, io);
    }, 1000 + Math.random() * 2000); // Random delay 1-3 seconds
    return;
  }

  // Choose a move (simple AI: pick random valid move)
  const chosenMove = validMoves[Math.floor(Math.random() * validMoves.length)];

  // Simulate thinking time
  setTimeout(() => {
    handleBotPlay(room, bot, chosenMove, io);
  }, 1500 + Math.random() * 2000); // Random delay 1.5-3.5 seconds
}

function handleBotPlay(room, bot, cards, io) {
  // Validate the combination
  const combination = validateCombination(cards);
  if (!combination) {
    return;
  }

  // Check if it can beat the current combination
  if (!canBeatCombination(combination, room.currentCombination)) {
    return;
  }

  // Remove played cards from bot's hand
  bot.hand = bot.hand.filter(c => !cards.includes(c));
  room.pile = cards;
  room.currentCombination = combination;
  // Don't reset passes here - only reset when a new round actually starts
  room.lastPlayer = bot.id; // Track who played last

  // Check if bot won
  if (bot.hand.length === 0) {
    room.winner = bot.id;
    room.gameStarted = false;
  } else {
    // Move to next player
    const currentIdx = room.players.findIndex(p => p.id === bot.id);
    const nextPlayerIdx = (currentIdx + 1) % room.players.length;
    const nextPlayer = room.players[nextPlayerIdx];

    // Skip players who have passed this round
    if (room.passes.includes(nextPlayer.id)) {
      // Find the next player who hasn't passed
      let foundValidPlayer = false;
      for (let i = 1; i < room.players.length; i++) {
        const checkIdx = (currentIdx + i) % room.players.length;
        const checkPlayer = room.players[checkIdx];
        if (!room.passes.includes(checkPlayer.id)) {
          room.turn = checkPlayer.id;
          foundValidPlayer = true;
          break;
        }
      }
    } else {
      room.turn = nextPlayer.id;
    }

    // If next player is also a bot, make them move
    const nextPlayerObj = room.players.find(p => p.id === room.turn);
    if (nextPlayerObj && nextPlayerObj.isBot) {
      setTimeout(() => makeBotMove(room, nextPlayerObj, io), 500);
    }
  }

  io.to(room.id).emit("game_update", room);
}

function handleBotPass(room, bot, io) {
  const playerId = bot.id;

  if (!room.passes.includes(playerId)) {
    room.passes.push(playerId);
  }

  // If all other players passed, start new round
  const activePlayers = room.players.filter(p => p.hand.length > 0);
  const passedPlayers = activePlayers.filter(p => room.passes.includes(p.id));

  if (passedPlayers.length === activePlayers.length - 1) {
    // All players passed, start new round with the player who played last
    room.currentCombination = null;
    room.passes = [];
    room.pile = []; // Clear the cards from the table
    room.round = (room.round || 1) + 1; // Increment round counter

    // Turn goes to the player who played the last card
    if (room.lastPlayer) {
      room.turn = room.lastPlayer;

      // If the last player is a bot, make them move
      const lastPlayerObj = room.players.find(p => p.id === room.lastPlayer);
      if (lastPlayerObj && lastPlayerObj.isBot) {
        setTimeout(() => makeBotMove(room, lastPlayerObj, io), 1000);
      }
    }

    // Don't emit game_update here - let the bot move trigger it if needed
    return;
  } else {
    // Move to next player
    const currentIdx = room.players.findIndex(p => p.id === bot.id);
    const nextPlayerIdx = (currentIdx + 1) % room.players.length;
    const nextPlayer = room.players[nextPlayerIdx];

    // Skip players who have passed this round
    if (room.passes.includes(nextPlayer.id)) {
      // Find the next player who hasn't passed
      let foundValidPlayer = false;
      for (let i = 1; i < room.players.length; i++) {
        const checkIdx = (currentIdx + i) % room.players.length;
        const checkPlayer = room.players[checkIdx];
        if (!room.passes.includes(checkPlayer.id)) {
          room.turn = checkPlayer.id;
          foundValidPlayer = true;
          break;
        }
      }
    } else {
      room.turn = nextPlayer.id;
    }

    // If next player is also a bot, make them move
    const nextPlayerObj = room.players.find(p => p.id === room.turn);
    if (nextPlayerObj && nextPlayerObj.isBot) {
      setTimeout(() => makeBotMove(room, nextPlayerObj, io), 500);
    }
  }

  io.to(room.id).emit("game_update", room);
}

export {
  makeBotMove,
  handleBotPlay,
  handleBotPass
};