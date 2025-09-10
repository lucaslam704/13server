// Socket event handlers with Supabase integration
import { rooms, setDatabaseLoader } from './roomManager.js';
import { initializeRooms } from './roomHelpers.js';
import { setupRoomHandlers } from './roomHandlers.js';
import { setupGameHandlers } from './gameHandlers.js';
import { setupPlayHandlers } from './playHandlers.js';
import { setupBotHandlers } from './botHandlers.js';
import { setupConnectionHandlers } from './connectionHandlers.js';
import { loadRoomFromDB, getRoomsFromDB } from './databaseHelpers.js';

function setupSocketHandlers(io, supabase) {
  // Initialize rooms on server start
  initializeRooms(supabase);

  // Inject the database loader function
  setDatabaseLoader((roomId) => loadRoomFromDB(roomId, supabase));

  // Setup all socket event handlers
  setupRoomHandlers(io, supabase);
  setupGameHandlers(io, supabase);
  setupPlayHandlers(io, supabase);
  setupBotHandlers(io, supabase);
  setupConnectionHandlers(io, supabase);

  // Improved periodic cleanup of empty rooms (every 2 minutes)
  setInterval(async () => {
    console.log('Running periodic room cleanup...');
    const now = Date.now();

    for (const [roomId, room] of rooms) {
      const totalPlayers = room.players.length + room.viewers.length;
      const connectedPlayers = room.players.filter(p => p.connected).length;
      const connectedViewers = room.viewers.filter(v => v.connected).length;
      const totalConnected = connectedPlayers + connectedViewers;

      console.log(`Room ${roomId}: ${totalPlayers} total (${connectedPlayers} connected players, ${connectedViewers} connected viewers), ${totalConnected} total connected`);

      // Clean up disconnected users from arrays (remove users disconnected for more than 30 seconds)
      const now = Date.now();
      room.players = room.players.filter(player => {
        if (!player.connected && player.disconnectedAt && (now - player.disconnectedAt) > 30000) {
          console.log(`Removing disconnected player ${player.id} from room ${roomId}`);
          return false;
        }
        return true;
      });

      room.viewers = room.viewers.filter(viewer => {
        if (!viewer.connected && viewer.disconnectedAt && (now - viewer.disconnectedAt) > 30000) {
          console.log(`Removing disconnected viewer ${viewer.id} from room ${roomId}`);
          return false;
        }
        return true;
      });

      // Recalculate counts after cleanup
      const cleanedTotalPlayers = room.players.length + room.viewers.length;
      const cleanedConnectedPlayers = room.players.filter(p => p.connected).length;
      const cleanedConnectedViewers = room.viewers.filter(v => v.connected).length;
      const cleanedTotalConnected = cleanedConnectedPlayers + cleanedConnectedViewers;

      console.log(`After cleanup: ${cleanedTotalPlayers} total (${cleanedConnectedPlayers} connected players, ${cleanedConnectedViewers} connected viewers), ${cleanedTotalConnected} total connected`);

      // Reset rooms with no active connections back to default state
      if (cleanedTotalConnected === 0) {
        console.log(`Resetting empty room: ${roomId} to default state`);
        // Reset room in memory
        room.players = [];
        room.viewers = [];
        room.pile = [];
        room.turn = null;
        room.currentCombination = null;
        room.gameStarted = false;
        room.winner = null;
        room.passes = [];
        room.lastPlayer = null;
        room.round = 1;
        room.deckShuffled = false;

        // Reset room in database - clear all data when no connected users
        try {
          await supabase
            .from('thirteen_rooms')
            .update({
              current_players: 0,
              active_connections: 0,
              players: [],
              viewers: [],
              game_started: false,
              game_state: {
                pile: [],
                currentCombination: null,
                turn: null,
                passes: [],
                lastPlayer: null,
                winner: null,
                round: 1,
                deckShuffled: false
              },
              connected_socket_ids: [],
              last_activity: new Date().toISOString()
            })
            .eq('room_id', roomId);
          console.log(`Reset room ${roomId} in database`);
        } catch (error) {
          console.error(`Failed to reset room ${roomId} in database:`, error);
        }
        continue;
      }

      // Reset rooms that have been inactive for more than 10 minutes
      const lastActivity = room.lastActivity || room.created;
      const inactiveTime = now - lastActivity;
      if (inactiveTime > 10 * 60 * 1000) { // 10 minutes
        console.log(`Resetting inactive room: ${roomId} (${Math.round(inactiveTime / 60000)} minutes inactive)`);
        // Reset room in memory to default state
        room.players = [];
        room.viewers = [];
        room.pile = [];
        room.turn = null;
        room.currentCombination = null;
        room.gameStarted = false;
        room.winner = null;
        room.passes = [];
        room.lastPlayer = null;
        room.round = 1;
        room.deckShuffled = false;

        // Reset room in database - clear all data for inactive rooms
        try {
          await supabase
            .from('thirteen_rooms')
            .update({
              current_players: 0,
              active_connections: 0,
              players: [],
              viewers: [],
              game_started: false,
              game_state: {
                pile: [],
                currentCombination: null,
                turn: null,
                passes: [],
                lastPlayer: null,
                winner: null,
                round: 1,
                deckShuffled: false
              },
              connected_socket_ids: [],
              last_activity: new Date().toISOString()
            })
            .eq('room_id', roomId);
          console.log(`Reset inactive room ${roomId} in database`);
        } catch (error) {
          console.error(`Failed to reset inactive room ${roomId} in database:`, error);
        }
        continue;
      }

      // Update room activity in database if there are active players
      if (totalPlayers > 0) {
        try {
          await supabase
            .from('thirteen_rooms')
            .update({
              last_activity: new Date().toISOString(),
              active_connections: totalPlayers
            })
            .eq('room_id', roomId);
        } catch (error) {
          console.error(`Failed to update activity for room ${roomId}:`, error);
        }
      }
    }

    // Note: We don't delete rooms from database - the 10 pre-created rooms should always exist
    // They get reset to default state when empty, but the records remain
  }, 2 * 60 * 1000); // 2 minutes
}

export { setupSocketHandlers };