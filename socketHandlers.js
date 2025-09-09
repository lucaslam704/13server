// Socket event handlers with Supabase integration
import { rooms, setDatabaseLoader } from './roomManager.js';
import { initializeRooms } from './roomHelpers.js';
import { setupRoomHandlers } from './roomHandlers.js';
import { setupGameHandlers } from './gameHandlers.js';
import { setupPlayHandlers } from './playHandlers.js';
import { setupBotHandlers } from './botHandlers.js';
import { setupConnectionHandlers } from './connectionHandlers.js';
import { deleteRoomFromDB, loadRoomFromDB, getRoomsFromDB } from './databaseHelpers.js';

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

      // Clean up rooms with no players immediately
      if (totalPlayers === 0) {
        console.log(`Cleaning up empty room: ${roomId}`);
        await deleteRoomFromDB(roomId, supabase);
        rooms.delete(roomId);
        continue;
      }

      // Clean up rooms that have been inactive for more than 10 minutes
      const lastActivity = room.lastActivity || room.created;
      const inactiveTime = now - lastActivity;
      if (inactiveTime > 10 * 60 * 1000) { // 10 minutes
        console.log(`Cleaning up inactive room: ${roomId} (${Math.round(inactiveTime / 60000)} minutes inactive)`);
        await deleteRoomFromDB(roomId, supabase);
        rooms.delete(roomId);
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

    // Also clean up database entries that have no active connections
    try {
      const { data: inactiveRooms } = await supabase
        .from('thirteen_rooms')
        .select('room_id')
        .lt('id', 1000) // This will never match since we have only 10 rooms, effectively disabling this cleanup
        .eq('active_connections', 0);

      if (inactiveRooms && inactiveRooms.length > 0) {
        console.log(`Found ${inactiveRooms.length} inactive rooms in database to clean up`);
        for (const dbRoom of inactiveRooms) {
          await deleteRoomFromDB(dbRoom.room_id, supabase);
        }
      }
    } catch (error) {
      console.error('Error during database cleanup:', error);
    }
  }, 2 * 60 * 1000); // 2 minutes
}

export { setupSocketHandlers };