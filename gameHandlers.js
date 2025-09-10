import { getRoom, getStartingPlayerForRoom } from './roomManager.js';
import { dealCards } from './cardUtils.js';
// Bot functionality removed - no bots in this game
import { createCleanRoomData } from './roomHelpers.js';

function setupGameHandlers(io, supabase) {
  io.on("connection", (socket) => {
    socket.on("start_game", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

      // Ensure room properties are initialized
      if (!room.players) room.players = [];

      // Check if all connected players are ready
      const connectedPlayers = room.players.filter(p => p.connected);
      if (connectedPlayers.length < 2) return; // Need at least 2 players

      const allPlayersReady = connectedPlayers.every(p => p.ready);
      if (!allPlayersReady) return; // All players must be ready

      // Reset game state completely before starting new game
      room.gameStarted = true;
      room.pile = [];
      room.currentCombination = null;
      room.winner = null;
      room.passes = [];
      room.lastPlayer = null;
      room.turn = null;
      room.round = 1; // Reset round counter to 1
      room.deckShuffled = true; // Flag to indicate deck is ready

      // Clear all players' hands to ensure clean slate
      room.players.forEach(player => {
        player.hand = [];
        player.ready = false; // Reset ready status for new game
      });

      console.log(`Game started in room ${roomId} with ${connectedPlayers.length} players`);
      io.to(roomId).emit("game_started", createCleanRoomData(room));
    });

    // Add explicit restart_game handler for better game restart flow
    socket.on("restart_game", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

      // Ensure room properties are initialized
      if (!room.players) room.players = [];

      // Check if there are enough connected players
      const connectedPlayers = room.players.filter(p => p.connected);
      if (connectedPlayers.length < 2) {
        // Allow single player to restart (for testing/development)
        console.log(`Allowing single player restart in room ${roomId}`);
      }

      // Check if all connected players are ready
      const allPlayersReady = connectedPlayers.every(p => p.ready);
      if (!allPlayersReady) {
        socket.emit("error", "All players must be ready to restart the game");
        return;
      }

      // Reset game state completely
      room.gameStarted = true;
      room.pile = [];
      room.currentCombination = null;
      room.winner = null;
      room.winnerLastCards = null; // Clear winner's last cards
      room.passes = [];
      room.lastPlayer = null;
      room.turn = null;
      room.round = 1;
      room.deckShuffled = true;

      // Clear all players' hands and reset ready status
      room.players.forEach(player => {
        player.hand = [];
        player.ready = false;
      });

      console.log(`Game restarted in room ${roomId} with ready check`);

      // Emit restart event first
      io.to(roomId).emit("game_restarted", createCleanRoomData(room));

      // Small delay before emitting game_started to allow client to process restart
      setTimeout(() => {
        io.to(roomId).emit("game_started", createCleanRoomData(room));
      }, 100);
    });

    // New event to deal cards after animation completes
    socket.on("deal_cards", async (roomId) => {
      console.log(`deal_cards event received for room ${roomId}`);
      const room = await getRoom(roomId);
      if (!room) {
        console.log(`Room ${roomId} not found for deal_cards`);
        return; // Room might have been cleaned up
      }
      if (!room.gameStarted || !room.deckShuffled) {
        console.log(`Game not started or deck not shuffled for room ${roomId}`);
        return;
      }

      console.log(`Dealing cards to ${room.players.length} players in room ${roomId}`);
      console.log(`Players before dealing:`, room.players.map(p => ({ name: p.name, connected: p.connected, handLength: p.hand?.length || 0 })));

      dealCards(room);

      // Set the first player
      room.turn = getStartingPlayerForRoom(room);
      room.deckShuffled = false; // Reset flag

      console.log(`Cards dealt. Players after dealing:`, room.players.map(p => ({ name: p.name, handLength: p.hand?.length || 0, hand: p.hand })));
      console.log(`First player (turn): ${room.turn}`);

      io.to(roomId).emit("cards_dealt", createCleanRoomData(room));

      // Bot functionality removed - no bots in this game
    });
  });
}

export { setupGameHandlers };