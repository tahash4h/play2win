const fs = require('fs');
const path = require('path');

// Function to parse CSV data
function parseCSV(csvContent) {
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',');
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      const values = lines[i].split(',');
      // Defensive: skip rows with wrong number of columns
      if (values.length !== headers.length) {
        console.warn(`Skipping malformed CSV row at line ${i+1}:`, lines[i]);
        continue;
      }
      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index] ? values[index].trim() : '';
      });
      data.push(row);
    }
  }
  
  return data;
}

// Function to process comprehensive analysis data
function processComprehensiveData(data) {
  // Get all unique games and opponents
  const games = [...new Set(data.map(row => row['Game ID']))].sort((a, b) => a - b);
  const opponents = [...new Set(data.map(row => row['Opponent']))].filter(opp => opp);
  
  // Process each game
  const gameData = games.map(gameId => {
    const gamePlays = data.filter(row => row['Game ID'] === gameId);
    const firstPlay = gamePlays[0];
    if (!firstPlay) {
      console.warn(`Skipping gameId ${gameId} because no plays found.`);
      return null;
    }
    // Defensive: check required fields
    if (!firstPlay['Opponent'] || !firstPlay['Date'] || !firstPlay['Season']) {
      console.warn(`Skipping gameId ${gameId} due to missing required fields.`, firstPlay);
      return null;
    }
    return {
      gameId: gameId,
      opponent: firstPlay['Opponent'],
      date: firstPlay['Date'],
      season: firstPlay['Season'],
      plays: gamePlays.map(play => ({
        minute: parseInt(play['Minute']) || 0,
        playType: play['Play Type'],
        shotAttempt: play['Shot Attempt'],
        shotDistance: play['Shot Distance'] ? parseInt(play['Shot Distance']) : null,
        shotOutcome: play['Shot Outcome'],
        xG: parseFloat(play['xG']) || 0,
        playContext: play['Play Context'],
        location: play['Location on Field'],
        outcome: play['Outcome'],
        success: play['Success'] === 'Yes',
        winImpact: parseInt(play['Win Impact']) || 0,
        assistType: play['Assist Type'],
        phaseOfMatch: play['Phase of Match']
      }))
    };
  }).filter(game => game !== null);

  // 1. Goals Timeline Data
  const goalsTimeline = [];
  gameData.forEach(game => {
    const goals = game.plays.filter(play => play.shotOutcome === 'Goal');
    goals.forEach(goal => {
      goalsTimeline.push({
        minute: goal.minute,
        gameId: game.gameId,
        opponent: game.opponent,
        playType: goal.playType,
        playContext: goal.playContext,
        location: goal.location,
        xG: goal.xG,
        winImpact: goal.winImpact
      });
    });
  });

  // 2. Shot Map Data (Location on Field)
  const shotMapData = {};
  const locations = [...new Set(data.map(row => row['Location on Field']))].filter(loc => loc);
  
  locations.forEach(location => {
    const locationPlays = data.filter(row => row['Location on Field'] === location && row['Shot Attempt'] === 'Yes');
    shotMapData[location] = {
      totalShots: locationPlays.length,
      goals: locationPlays.filter(play => play['Shot Outcome'] === 'Goal').length,
      avgXG: locationPlays.reduce((sum, play) => sum + (parseFloat(play['xG']) || 0), 0) / locationPlays.length || 0,
      successRate: locationPlays.length > 0 ? 
        (locationPlays.filter(play => play['Shot Outcome'] === 'Goal').length / locationPlays.length) * 100 : 0
    };
  });

  // 3. Play Type Distribution
  const playTypeData = {};
  const playTypes = [...new Set(data.map(row => row['Play Type']))].filter(type => type);
  
  playTypes.forEach(playType => {
    const typePlays = data.filter(row => row['Play Type'] === playType);
    playTypeData[playType] = {
      count: typePlays.length,
      shots: typePlays.filter(play => play['Shot Attempt'] === 'Yes').length,
      goals: typePlays.filter(play => play['Shot Outcome'] === 'Goal').length,
      avgXG: typePlays.reduce((sum, play) => sum + (parseFloat(play['xG']) || 0), 0) / typePlays.length || 0
    };
  });

  // 4. Team Comparison Data
  const teamComparison = {};
  opponents.forEach(opponent => {
    const opponentGames = gameData.filter(game => game.opponent === opponent);
    const allPlays = opponentGames.flatMap(game => game.plays);
    
    teamComparison[opponent] = {
      gamesPlayed: opponentGames.length,
      totalGoals: allPlays.filter(play => play.shotOutcome === 'Goal').length,
      totalShots: allPlays.filter(play => play.shotAttempt === 'Yes').length,
      totalXG: allPlays.reduce((sum, play) => sum + play.xG, 0),
      conversionRate: allPlays.filter(play => play.shotAttempt === 'Yes').length > 0 ?
        (allPlays.filter(play => play.shotOutcome === 'Goal').length / 
         allPlays.filter(play => play.shotAttempt === 'Yes').length) * 100 : 0,
      avgXGPerShot: allPlays.filter(play => play.shotAttempt === 'Yes').length > 0 ?
        allPlays.reduce((sum, play) => sum + play.xG, 0) / 
        allPlays.filter(play => play.shotAttempt === 'Yes').length : 0
    };
  });

  // 5. Key Statistics
  const keyStats = {
    totalGames: games.length,
    totalGoals: data.filter(row => row['Shot Outcome'] === 'Goal').length,
    totalShots: data.filter(row => row['Shot Attempt'] === 'Yes').length,
    totalXG: data.reduce((sum, row) => sum + (parseFloat(row['xG']) || 0), 0),
    overallConversionRate: data.filter(row => row['Shot Attempt'] === 'Yes').length > 0 ?
      (data.filter(row => row['Shot Outcome'] === 'Goal').length / 
       data.filter(row => row['Shot Attempt'] === 'Yes').length) * 100 : 0,
    avgXGPerShot: data.filter(row => row['Shot Attempt'] === 'Yes').length > 0 ?
      data.reduce((sum, row) => sum + (parseFloat(row['xG']) || 0), 0) / 
      data.filter(row => row['Shot Attempt'] === 'Yes').length : 0
  };

  return {
    goalsTimeline,
    shotMapData,
    playTypeData,
    teamComparison,
    keyStats,
    games: gameData,
    opponents
  };
}

// API endpoint
function getComprehensiveData(req, res) {
  try {
    // Read the CSV file
    const csvPath = path.join(__dirname, '..', '..', 'match_data.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');

    // Parse CSV data
    const data = parseCSV(csvContent);

    // Process data for comprehensive analysis
    const comprehensiveData = processComprehensiveData(data);

    // Defensive: check for required top-level properties
    if (!comprehensiveData.goalsTimeline || !comprehensiveData.games) {
      console.error('Comprehensive data missing required properties:', comprehensiveData);
      return res.status(500).json({ error: 'Comprehensive data missing required properties' });
    }

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    res.json(comprehensiveData);
  } catch (error) {
    console.error('Error processing comprehensive data:', error);
    res.status(500).json({ error: 'Failed to process comprehensive data', details: error.message, stack: error.stack });
  }
}

module.exports = { getComprehensiveData };
