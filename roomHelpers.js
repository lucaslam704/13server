import { rooms } from './roomManager.js';
import { saveRoomToDB } from './databaseHelpers.js';

// Cache for profile pictures to avoid repeated database calls
const profilePicCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to fetch and update profile pictures for players and viewers (optimized)
async function updatePlayerProfilePics(room, supabaseClient) {
  if ((!room.players || room.players.length === 0) && (!room.viewers || room.viewers.length === 0)) return;

  // Get all user IDs that need profile pictures and aren't cached or cache is expired
  const userIdsToFetch = [];
  const now = Date.now();

  // Check players (no bots in this game)
  room.players?.forEach(player => {
    if (player.userId) {
      const cached = profilePicCache.get(player.userId);
      if (!cached || (now - cached.timestamp) > CACHE_DURATION) {
        userIdsToFetch.push(player.userId);
      } else {
        // Use cached profile picture
        player.profilePic = cached.profilePic;
      }
    }
  });

  // Check viewers
  room.viewers?.forEach(viewer => {
    if (viewer.userId) {
      const cached = profilePicCache.get(viewer.userId);
      if (!cached || (now - cached.timestamp) > CACHE_DURATION) {
        userIdsToFetch.push(viewer.userId);
      } else {
        // Use cached profile picture
        viewer.profilePic = cached.profilePic;
      }
    }
  });

  if (userIdsToFetch.length === 0) return;

  try {
    const { data, error } = await supabaseClient
      .from('users')
      .select('id, profile_pic')
      .in('id', userIdsToFetch);

    if (error) {
      console.error('Error fetching profile pictures:', error);
      return;
    }

    // Update cache and player objects with profile pictures
    data.forEach(userData => {
      profilePicCache.set(userData.id, {
        profilePic: userData.profile_pic,
        timestamp: now
      });

      // Update player objects
      room.players?.forEach(player => {
        if (player.userId === userData.id) {
          player.profilePic = userData.profile_pic;
        }
      });

      // Update viewer objects
      room.viewers?.forEach(viewer => {
        if (viewer.userId === userData.id) {
          viewer.profilePic = userData.profile_pic;
        }
      });
    });

    console.log(`Updated profile pictures for ${data.length} users in room:`, room.id);
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
    players: room.players.map(p => ({
      id: p.id,
      userId: p.userId,
      name: p.name,
      hand: p.hand,
      connected: p.connected,
      ready: p.ready,
      isBot: p.isBot,
      profilePic: p.profilePic
    })),
    viewers: room.viewers.map(v => ({
      id: v.id,
      userId: v.userId,
      name: v.name
    })),
    pile: room.pile,
    turn: room.turn,
    currentCombination: room.currentCombination,
    gameStarted: room.gameStarted,
    winner: room.winner,
    winnerLastCards: room.winnerLastCards,
    passes: room.passes,
    lastPlayer: room.lastPlayer,
    lastTurn: room.lastTurn,
    deckShuffled: room.deckShuffled,
    round: room.round
  };
}

export { updatePlayerProfilePics, initializeRooms, createCleanRoomData };