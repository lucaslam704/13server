import { rooms } from './roomManager.js';
import { saveRoomToDB, getRoomsFromDB } from './databaseHelpers.js';
import { createCleanRoomData } from './roomHelpers.js';

function setupConnectionHandlers(io, supabase) {
  io.on("connection", (socket) => {
    socket.on("disconnect", async () => {
      console.log(`User ${socket.id} disconnected`);

      // Mark player as disconnected in all rooms (don't remove them)
      for (const [roomId, room] of rooms) {
        let roomChanged = false;

        // Find player in room (could be in players or viewers)
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        const viewerIndex = room.viewers.findIndex(v => v.id === socket.id);

        if (playerIndex !== -1) {
          const player = room.players[playerIndex];
          player.connected = false;
          roomChanged = true;
          console.log(`Marked player ${socket.id} as disconnected in room ${roomId}`);

          // Reset countdown when someone disconnects
          if (room.countdownInterval) {
            clearInterval(room.countdownInterval);
            room.countdownInterval = null;
          }
          room.countdownTime = null;

          // If it was this player's turn and game is in progress, handle turn passing
          if (room.gameStarted && room.turn === socket.id) {
            setTimeout(async () => {
              // Check if player is still disconnected and still their turn
              const currentPlayer = room.players.find(p => p.id === socket.id);
              if (currentPlayer && !currentPlayer.connected && room.turn === socket.id) {
                console.log(`Handling turn for disconnected player ${socket.id} in room ${roomId}`);

                // Check if all connected players have left
                const connectedPlayers = room.players.filter(p => p.connected && p.chair !== null);

                if (connectedPlayers.length === 0) {
                  // All players disconnected, stop the game and go back to waiting state
                  console.log(`All players disconnected in room ${roomId}, stopping game`);
                  room.gameStarted = false;
                  room.pile = [];
                  room.currentCombination = null;
                  room.winner = null;
                  room.passes = [];
                  room.lastPlayer = null;
                  room.turn = null;
                  room.round = 1;
                  room.deckShuffled = false;

                  // Reset all players' ready status
                  room.players.forEach(player => {
                    player.ready = false;
                  });
                } else {
                  // Pass the turn to the next connected player
                  const currentIdx = room.players.findIndex(p => p.id === socket.id);
                  let nextPlayerIdx = (currentIdx + 1) % room.players.length;
                  let nextPlayer = room.players[nextPlayerIdx];

                  // Find the next connected player
                  let attempts = 0;
                  while (!nextPlayer.connected && attempts < room.players.length) {
                    nextPlayerIdx = (nextPlayerIdx + 1) % room.players.length;
                    nextPlayer = room.players[nextPlayerIdx];
                    attempts++;
                  }

                  if (nextPlayer.connected) {
                    room.turn = nextPlayer.id;
                    console.log(`Turn passed to ${nextPlayer.id} after ${socket.id} disconnected`);
                  } else {
                    // No connected players found, stop the game
                    console.log(`No connected players found, stopping game in room ${roomId}`);
                    room.gameStarted = false;
                    room.pile = [];
                    room.currentCombination = null;
                    room.winner = null;
                    room.passes = [];
                    room.lastPlayer = null;
                    room.turn = null;
                    room.round = 1;
                    room.deckShuffled = false;

                    room.players.forEach(player => {
                      player.ready = false;
                    });
                  }
                }

                // Save and broadcast updated room
                await saveRoomToDB(room, supabase);
                io.to(roomId).emit("game_update", createCleanRoomData(room));
              }
            }, 2000); // 2 seconds delay
          }
        } else if (viewerIndex !== -1) {
          const viewer = room.viewers[viewerIndex];
          viewer.connected = false;
          roomChanged = true;
          console.log(`Marked viewer ${socket.id} as disconnected in room ${roomId}`);
        }

        // Save room changes to database
        if (roomChanged) {
          await saveRoomToDB(room, supabase);
          console.log(`Saved room changes for ${roomId} to database`);
        }

        // Broadcast room update
        io.to(roomId).emit("room_update", createCleanRoomData(room));
        console.log(`Broadcasted room update for ${roomId}`);
      }

      // Broadcast updated room list
      const roomsList = await getRoomsFromDB(supabase);
      io.emit("rooms_list", roomsList);
      console.log(`Broadcasted updated room list`);
    });
  });
}

export { setupConnectionHandlers };