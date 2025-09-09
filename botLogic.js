// Bot AI logic and movement functions
import { validateCombination, canBeatCombination, getValidMoves } from './gameLogic.js';

// Bot AI logic
function makeBotMove(room, bot, io) {
  console.log(`[DEBUG] Bot ${bot.name} making move. Hand: [${bot.hand.join(', ')}]`);
  console.log(`[DEBUG] Current combination:`, room.currentCombination);

  // Get valid moves for the bot
  const validMoves = getValidMoves(bot.hand, room.currentCombination);
  console.log(`[DEBUG] Bot ${bot.name} has ${validMoves.length} valid moves`);

  if (validMoves.length === 0) {
    // No valid moves, bot must pass
    console.log(`[DEBUG] Bot ${bot.name} has no valid moves, passing...`);
    setTimeout(() => {
      handleBotPass(room, bot, io);
    }, 1000 + Math.random() * 2000); // Random delay 1-3 seconds
    return;
  }

  // Choose a move (simple AI: pick random valid move)
  const chosenMove = validMoves[Math.floor(Math.random() * validMoves.length)];
  console.log(`[DEBUG] Bot ${bot.name} chose move: [${chosenMove.join(', ')}]`);

  // Simulate thinking time
  setTimeout(() => {
    handleBotPlay(room, bot, chosenMove, io);
  }, 1500 + Math.random() * 2000); // Random delay 1.5-3.5 seconds
}

function handleBotPlay(room, bot, cards, io) {
  console.log(`[DEBUG] Bot ${bot.name} (${bot.id}) playing cards in round ${room.round}: [${cards.join(', ')}]`);
  console.log(`[DEBUG] Current passes before bot play: [${room.passes.join(', ')}]`);

  // Validate the combination
  const combination = validateCombination(cards);
  if (!combination) {
    console.log(`[DEBUG] Invalid combination played by bot ${bot.name}`);
    return;
  }

  // Check if it can beat the current combination
  if (!canBeatCombination(combination, room.currentCombination)) {
    console.log(`[DEBUG] Bot ${bot.name} combination cannot beat current combination`);
    return;
  }

  // Remove played cards from bot's hand
  bot.hand = bot.hand.filter(c => !cards.includes(c));
  room.pile = cards;
  room.currentCombination = combination;
  // Don't reset passes here - only reset when a new round actually starts
  room.lastPlayer = bot.id; // Track who played last

  console.log(`[DEBUG] Bot play successful! Passes unchanged: [${room.passes.join(', ')}]`);
  console.log(`[DEBUG] Last player set to bot: ${bot.name} (${bot.id})`);

  // Check if bot won
  if (bot.hand.length === 0) {
    room.winner = bot.id;
    room.gameStarted = false;
    console.log(`[DEBUG] Bot ${bot.name} won the game!`);
  } else {
    // Move to next player
    const currentIdx = room.players.findIndex(p => p.id === bot.id);
    const nextPlayerIdx = (currentIdx + 1) % room.players.length;
    const nextPlayer = room.players[nextPlayerIdx];

    // Skip players who have passed this round
    if (room.passes.includes(nextPlayer.id)) {
      console.log(`[DEBUG] Next player ${nextPlayer.name} has already passed this round, skipping...`);
      // Find the next player who hasn't passed
      let foundValidPlayer = false;
      for (let i = 1; i < room.players.length; i++) {
        const checkIdx = (currentIdx + i) % room.players.length;
        const checkPlayer = room.players[checkIdx];
        if (!room.passes.includes(checkPlayer.id)) {
          room.turn = checkPlayer.id;
          console.log(`[DEBUG] Found valid next player: ${checkPlayer.name} (${checkPlayer.id})`);
          foundValidPlayer = true;
          break;
        }
      }
      if (!foundValidPlayer) {
        console.log(`[DEBUG] ERROR: No valid players found to take turn!`);
      }
    } else {
      room.turn = nextPlayer.id;
      console.log(`[DEBUG] Turn moved to: ${nextPlayer.name} (${nextPlayer.id})`);
    }

    // If next player is also a bot, make them move
    const nextPlayerObj = room.players.find(p => p.id === room.turn);
    if (nextPlayerObj && nextPlayerObj.isBot) {
      setTimeout(() => makeBotMove(room, nextPlayerObj, io), 500);
    }
  }

  console.log(`[DEBUG] Final turn after bot play: ${room.players.find(p => p.id === room.turn)?.name} (${room.turn})`);
  console.log(`[DEBUG] --- End of bot play handler ---\n`);

  io.to(room.id).emit("game_update", room);
}

function handleBotPass(room, bot, io) {
  const playerId = bot.id;

  console.log(`[DEBUG] Bot ${bot.name} (${playerId}) is passing in round ${room.round}`);
  console.log(`[DEBUG] Current passes before: [${room.passes.join(', ')}]`);
  console.log(`[DEBUG] Bot hand: [${bot.hand.join(', ')}]`);

  if (!room.passes.includes(playerId)) {
    room.passes.push(playerId);
    console.log(`[DEBUG] Added bot ${bot.name} to passes. New passes: [${room.passes.join(', ')}]`);
  } else {
    console.log(`[DEBUG] Bot ${bot.name} already in passes, skipping duplicate`);
  }

  // If all other players passed, start new round
  const activePlayers = room.players.filter(p => p.hand.length > 0);
  const passedPlayers = activePlayers.filter(p => room.passes.includes(p.id));

  console.log(`[DEBUG] Active players: ${activePlayers.length}, Passed players: ${passedPlayers.length}`);
  console.log(`[DEBUG] Active player IDs: [${activePlayers.map(p => p.id).join(', ')}]`);
  console.log(`[DEBUG] Passed player IDs: [${passedPlayers.map(p => p.id).join(', ')}]`);

  if (passedPlayers.length === activePlayers.length - 1) {
    // All players passed, start new round with the player who played last
    console.log(`[DEBUG] All players passed! Starting new round. Clearing passes array.`);
    room.currentCombination = null;
    room.passes = [];
    room.pile = []; // Clear the cards from the table
    room.round = (room.round || 1) + 1; // Increment round counter
    console.log(`[DEBUG] Round incremented to ${room.round}. Passes cleared: [${room.passes.join(', ')}]`);

    // Turn goes to the player who played the last card
    if (room.lastPlayer) {
      room.turn = room.lastPlayer;
      const lastPlayerName = room.players.find(p => p.id === room.lastPlayer)?.name || 'Unknown';
      console.log(`[DEBUG] Turn goes to last player: ${lastPlayerName} (${room.lastPlayer})`);

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
      console.log(`[DEBUG] Next player ${nextPlayer.name} has already passed this round, skipping...`);
      // Find the next player who hasn't passed
      let foundValidPlayer = false;
      for (let i = 1; i < room.players.length; i++) {
        const checkIdx = (currentIdx + i) % room.players.length;
        const checkPlayer = room.players[checkIdx];
        if (!room.passes.includes(checkPlayer.id)) {
          room.turn = checkPlayer.id;
          console.log(`[DEBUG] Found valid next player: ${checkPlayer.name} (${checkPlayer.id})`);
          foundValidPlayer = true;
          break;
        }
      }
      if (!foundValidPlayer) {
        console.log(`[DEBUG] ERROR: No valid players found to take turn!`);
      }
    } else {
      room.turn = nextPlayer.id;
      console.log(`[DEBUG] Turn moved to: ${nextPlayer.name} (${nextPlayer.id})`);
    }

    // If next player is also a bot, make them move
    const nextPlayerObj = room.players.find(p => p.id === room.turn);
    if (nextPlayerObj && nextPlayerObj.isBot) {
      setTimeout(() => makeBotMove(room, nextPlayerObj, io), 500);
    }
  }

  console.log(`[DEBUG] Final turn: ${room.players.find(p => p.id === room.turn)?.name} (${room.turn})`);
  console.log(`[DEBUG] Final passes: [${room.passes.join(', ')}]`);
  console.log(`[DEBUG] --- End of bot pass handler ---\n`);

  io.to(room.id).emit("game_update", room);
}

export {
  makeBotMove,
  handleBotPlay,
  handleBotPass
};