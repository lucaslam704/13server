// Database helper functions
async function saveRoomToDB(room, supabaseClient) {
  try {
    console.log('saveRoomToDB called with room:', {
      id: room.id,
      name: room.name,
      playersCount: room.players?.length || 0
    });

    // Get connected socket IDs for better tracking
    const connectedSocketIds = [];
    room.players.forEach(p => {
      if (p.connected) connectedSocketIds.push(p.id);
    });

    // Prepare players data for database
    const playersData = room.players.map(player => ({
      id: player.id,
      userId: player.userId,
      name: player.name,
      hand: player.hand,
      connected: player.connected,
      ready: player.ready,
      isBot: player.isBot,
      profilePic: player.profilePic
    }));

    const upsertData = {
      room_id: room.id,
      room_name: room.name,
      current_players: room.players.filter(p => p.connected).length,
      active_connections: connectedSocketIds.length,
      players: playersData,
      connected_socket_ids: connectedSocketIds,
      game_started: room.gameStarted,
      game_state: {
        pile: room.pile,
        currentCombination: room.currentCombination,
        turn: room.turn,
        passes: room.passes,
        lastPlayer: room.lastPlayer,
        winner: room.winner,
        round: room.round,
        deckShuffled: room.deckShuffled
      },
      is_active: true,
      last_activity: new Date().toISOString()
    };

    console.log('Attempting to upsert room data:', JSON.stringify(upsertData, null, 2));

    const { data, error } = await supabaseClient
      .from('thirteen_rooms')
      .upsert(upsertData, {
        onConflict: 'room_id'
      });

    if (error) {
      console.error('Error saving room to DB:', error);
      // If it's a foreign key constraint error, log it but don't crash
      if (error.code === '23503') {
        console.log('Foreign key constraint error - likely invalid user UUID. Room saved in memory only.');
        return { success: true, inMemoryOnly: true };
      }
      return { success: false, error };
    }

    console.log('Successfully saved room to database:', room.id);
    return { success: true };
  } catch (err) {
    console.error('Error in saveRoomToDB:', err);
    return { success: false, error: err };
  }
}

async function loadRoomFromDB(roomId, supabaseClient) {
  try {
    const { data, error } = await supabaseClient
      .from('thirteen_rooms')
      .select('*')
      .eq('room_id', roomId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error loading room from DB:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    console.log('Successfully loaded room from database:', roomId);
    return data;
  } catch (err) {
    console.error('Error in loadRoomFromDB:', err);
    return null;
  }
}

async function deleteRoomFromDB(roomId, supabaseClient) {
  try {
    const { error } = await supabaseClient
      .from('thirteen_rooms')
      .update({ is_active: false })
      .eq('room_id', roomId);

    if (error) {
      console.error('Error deleting room from DB:', error);
      return { success: false, error };
    }

    console.log('Successfully deleted room from database:', roomId);
    return { success: true };
  } catch (err) {
    console.error('Error in deleteRoomFromDB:', err);
    return { success: false, error: err };
  }
}

async function getRoomsFromDB(supabaseClient) {
  try {
    const { data, error } = await supabaseClient
      .from('thirteen_rooms')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error getting rooms from DB:', error);
      // Return default rooms if database error
      return getDefaultRooms();
    }

    if (!data || data.length === 0) {
      console.log('No rooms found in database, returning default rooms');
      return getDefaultRooms();
    }

    console.log('Successfully loaded rooms list from database:', data.length, 'rooms');
    return data.map(room => ({
      id: room.room_id,
      playerCount: room.current_players,
      gameStarted: room.game_started,
      created: new Date(room.created_at).getTime()
    }));
  } catch (err) {
    console.error('Error in getRoomsFromDB:', err);
    // Return default rooms if error
    return getDefaultRooms();
  }
}

function getDefaultRooms() {
  const defaultRooms = [];
  for (let i = 1; i <= 10; i++) {
    const roomId = `room_${i.toString().padStart(2, '0')}`;
    defaultRooms.push({
      id: roomId,
      playerCount: 0,
      gameStarted: false,
      created: Date.now()
    });
  }
  console.log('Returning default rooms:', defaultRooms.length);
  return defaultRooms;
}

export { saveRoomToDB, loadRoomFromDB, deleteRoomFromDB, getRoomsFromDB, getDefaultRooms };