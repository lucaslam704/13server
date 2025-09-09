import { rooms } from './roomManager.js';
import { saveRoomToDB, deleteRoomFromDB } from './databaseHelpers.js';

// Helper function to fetch and update profile pictures for players
async function updatePlayerProfilePics(room, supabaseClient) {
  if (!room.players || room.players.length === 0) return;

  // Get all user IDs that need profile pictures
  const userIds = room.players
    .filter(p => p.userId && !p.isBot)
    .map(p => p.userId);

  if (userIds.length === 0) return;

  try {
    const { data, error } = await supabaseClient
      .from('users')
      .select('id, profile_pic')
      .in('id', userIds);

    if (error) {
      console.error('Error fetching profile pictures:', error);
      return;
    }

    // Update player objects with profile pictures
    room.players.forEach(player => {
      if (player.userId && !player.isBot) {
        const userData = data.find(u => u.id === player.userId);
        if (userData) {
          player.profilePic = userData.profile_pic;
        }
      }
    });

    console.log('Updated profile pictures for players in room:', room.id);
  } catch (err) {
    console.error('Error updating player profile pictures:', err);
  }
}

async function initializeRooms(supabase) {
  try {
    console.log('Initializing Thirteen rooms...');

    // Check if rooms already exist
    const { data: existingRooms, error: checkError } = await supabase
      .from('thirteen_rooms')
      .select('room_id')
      .limit(1);

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking for existing rooms:', checkError);
      return;
    }

    if (existingRooms && existingRooms.length > 0) {
      console.log('Rooms already exist, skipping initialization');
      return;
    }

    // Create the 10 rooms
    const roomsToCreate = [];
    for (let i = 1; i <= 10; i++) {
      const roomId = `room_${i.toString().padStart(2, '0')}`;
      const roomName = `Room ${i}`;
      roomsToCreate.push({
        room_id: roomId,
        room_name: roomName,
        seats: [
          { playerId: null, userId: null, name: null, connected: false, ready: false },
          { playerId: null, userId: null, name: null, connected: false, ready: false },
          { playerId: null, userId: null, name: null, connected: false, ready: false },
          { playerId: null, userId: null, name: null, connected: false, ready: false }
        ]
      });
    }

    const { data, error } = await supabase
      .from('thirteen_rooms')
      .insert(roomsToCreate);

    if (error) {
      console.error('Error creating rooms:', error);
    } else {
      console.log(`Successfully created ${roomsToCreate.length} rooms`);
    }
  } catch (err) {
    console.error('Error in initializeRooms:', err);
  }
}

// Helper function to create clean room data for socket emission
function createCleanRoomData(room) {
  return {
    id: room.id,
    name: room.name,
    owner: room.owner,
    players: room.players.map(p => ({
      id: p.id,
      userId: p.userId,
      name: p.name,
      hand: p.hand,
      connected: p.connected,
      chair: p.chair,
      ready: p.ready,
      isBot: p.isBot,
      profilePic: p.profilePic
    })),
    viewers: room.viewers.map(v => ({
      id: v.id,
      userId: v.userId,
      name: v.name
    })),
    chairs: room.chairs,
    pile: room.pile,
    turn: room.turn,
    currentCombination: room.currentCombination,
    gameStarted: room.gameStarted,
    winner: room.winner,
    winnerLastCards: room.winnerLastCards,
    passes: room.passes,
    lastPlayer: room.lastPlayer,
    deckShuffled: room.deckShuffled,
    round: room.round
  };
}

export { updatePlayerProfilePics, initializeRooms, createCleanRoomData };