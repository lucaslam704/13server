import { getRoom } from './roomManager.js';
import { validateCombination, canBeatCombination } from './cardUtils.js';
// Bot functionality removed - no bots in this game
import { createCleanRoomData } from './roomHelpers.js';

function setupPlayHandlers(io, supabase) {
  io.on("connection", (socket) => {
    socket.on("play_cards", async ({ roomId, cards }) => {
      console.log(`Player ${socket.id} attempting to play cards:`, cards);
      const room = await getRoom(roomId);
      if (!room) {
        console.log(`Room ${roomId} not found`);
        return; // Room might have been cleaned up
      }
      if (!room.gameStarted) {
        console.log(`Game not started in room ${roomId}`);
        return;
      }

      const player = room.players.find(p => p.id === socket.id);
      if (!player || room.turn !== socket.id) {
        console.log(`Player not found or not their turn. Player:`, player, `Turn:`, room.turn);
        return;
      }

      // Validate the combination
      const combination = validateCombination(cards);
      console.log(`Combination validation result:`, combination);
      if (!combination) {
        console.log(`Invalid combination:`, cards);
        return; // Invalid combination
      }

      // Check if it can beat the current combination
      const canBeat = canBeatCombination(combination, room.currentCombination);
      console.log(`Can beat current combination?`, canBeat);
      console.log(`Current combination:`, room.currentCombination);
      console.log(`New combination:`, combination);
      if (!canBeat) {
        console.log(`Cannot beat current combination`);
        return;
      }

      // Check if player has all the cards
      const hasAllCards = cards.every(card => player.hand.includes(card));
      if (!hasAllCards) {
        return;
      }

      // Remove played cards from hand
      player.hand = player.hand.filter(c => !cards.includes(c));
      room.pile = cards;
      room.currentCombination = combination;
      // Don't reset passes here - only reset when a new round actually starts
      room.lastPlayer = player.id; // Track who played last

      // Check if player won
      if (player.hand.length === 0) {
        room.winner = player.id;
        room.winnerLastCards = cards; // Store the winning cards
        room.lastTurn = {
          playerId: player.id,
          playerName: player.name,
          cards: cards,
          timestamp: Date.now(),
          isWinningMove: true
        }; // Store last turn information
        room.gameStarted = false;
      } else {
        // Move to next player
        const currentIdx = room.players.findIndex(p => p.id === socket.id);
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

        // Bot functionality removed - no bots in this game
      }

      io.to(roomId).emit("game_update", createCleanRoomData(room));
    });

    socket.on("pass", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up
      if (!room.gameStarted || room.turn !== socket.id) return;

      const playerId = socket.id;

      if (!room.passes.includes(playerId)) {
        room.passes.push(playerId);
      }

      // If all other players passed, start new round
      const activePlayers = room.players.filter(p => p.hand.length > 0);
      const passedPlayers = activePlayers.filter(p => room.passes.includes(p.id));

      if (passedPlayers.length === activePlayers.length - 1) {
        // All players passed, start new round with the player who played the last card
        room.currentCombination = null;
        room.passes = [];
        room.pile = []; // Clear the cards from the table
        room.round = (room.round || 1) + 1; // Increment round counter

        // Turn goes to the player who played the last card
        if (room.lastPlayer) {
          room.turn = room.lastPlayer;

          // Bot functionality removed - no bots in this game
        }

        // Always emit game_update when turn changes, even for bots
        io.to(roomId).emit("game_update", room);
        return;
      } else {
        // Move to next player
        const currentIdx = room.players.findIndex(p => p.id === socket.id);
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

        // Bot functionality removed - no bots in this game
      }

      io.to(roomId).emit("game_update", room);
    });
  });
}

export { setupPlayHandlers };