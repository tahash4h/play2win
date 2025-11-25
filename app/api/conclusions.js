const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const csvParse = require('csv-parse/sync');

// We'll synthesize both a researcher-style analysis and a model-style analysis,
// then produce a concise coach-style conclusion that summarizes both.

const researcherSystemPrompt = `
You're a human soccer analyst speaking directly to another coach or teammate. 
Write naturally and confidently, as if you're making a real-world prediction after 
reviewing match footage and data.

Keep it conversational and grounded. Use short, clear sentences. 
Start by restating the user's question in plain language, then give a quick, 
plain-English prediction. After that, explain the data that led you to that conclusion.

When you explain your reasoning:
- Highlight concrete patterns or examples from past games (give 1–3 illustrative examples).
- Call out key metrics (xG, location, minute ranges, success rates) that matter for your verdict.
- Mention any situational caveats (e.g., opponent strength, fatigue, scoreline) that could change the recommendation.

Respond as if you're telling the coach/player what the decision should be and why.
Whether the play is good or bad, be clear and direct.


Critical instruction about listing occurrences: 
IF AND ONLY IF there are multiple distinct past occurrences of the exact situation the 
user asked about, list them as short bullet points (opponent, minute, location). 
If there is only one or none, do not attempt to list multiple occurrences—just 
summarize the evidence.
`;

const modelSystemPrompt = `
You are an advanced AI model specialized in soccer match prediction and analysis. Speak like a careful but decisive analyst: restate the user's question, give a concise numerical prediction, then explain the statistical reasons.

Focus on precise, data-driven output: cite relevant metrics and representative examples (do not include internal game IDs). If exact matches are missing, describe the approximation method used (minute ranges, location similarity, opponent averages).
`;

async function tryGenerate(genAI, prompt) {
	const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-1.0-pro'];
	let lastError = null;
	for (const modelName of modelsToTry) {
		try {
			const model = genAI.getGenerativeModel({ model: modelName });
			const result = await model.generateContent(prompt);
			const text = result.response && result.response.text ? result.response.text() : null;
			if (text) return { model: modelName, text };
		} catch (err) {
			lastError = err;
			const msg = (err.message || '').toLowerCase();
			if (msg.includes('not found') || msg.includes('404') || msg.includes('model')) {
				console.log(`Model ${modelName} not available, trying next...`);
				continue;
			}
			throw err;
		}
	}
	throw lastError || new Error('All model attempts failed');
}

async function getConclusion(req, res) {
	try {
		const { query, researcher: providedResearcher, model: providedModel } = req.body;

		if (!providedResearcher && !providedModel && (!query || query.trim() === '')) {
			return res.status(400).json({ error: 'Either query or researcher/model texts are required' });
		}

		if (!process.env.GEMINI_API_KEY) {
			return res.status(500).json({ error: 'Gemini API key not configured', details: 'Please set GEMINI_API_KEY in your .env file' });
		}

		const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

		// Load and parse match_data.csv
		const csvPath = path.resolve(__dirname, '../../..', 'match_data.csv');
		let csvRows = [];
		try {
			const csvContent = fs.readFileSync(csvPath, 'utf8');
			csvRows = csvParse.parse(csvContent, {
				columns: true,
				skip_empty_lines: true,
			});
		} catch (err) {
			console.error('Error reading match_data.csv:', err);
		}

		// Filter relevant rows based on the user's query (simple keyword match)
		const queryLower = (query || '').toLowerCase();
		const relevantRows = csvRows.filter(row => {
			return Object.values(row).some(val => String(val).toLowerCase().includes(queryLower));
		});

		// Format up to 5 relevant rows for the prompt
		let relevantDataText = '';
		if (relevantRows.length > 0) {
			relevantDataText = 'Relevant match data rows:\n';
			relevantRows.slice(0, 5).forEach(row => {
				relevantDataText += `- Opponent: ${row['Opponent']}, Minute: ${row['Minute']}, Play Type: ${row['Play Type']}, Shot Attempt: ${row['Shot Attempt']}, Shot Outcome: ${row['Shot Outcome']}, xG: ${row['xG']}, Location: ${row['Location on Field']}, Outcome: ${row['Outcome']}\n`;
			});
		} else {
			relevantDataText = 'No directly matching rows found for this query.';
		}

		const dataSummary = `You have access to soccer match data including:\n- Game information (opponents, dates, seasons)\n- Play-by-play data with minutes, play types, shot attempts, outcomes\n- Expected goals (xG) values\n- Shot locations and distances\n- Play contexts and phases of match\n- Team performance metrics\n\n${relevantDataText}`;

		let researcherText = providedResearcher || null;
		let modelText = providedModel || null;

		// If researcher/model texts not provided, fall back to generating them from the query
		if (!researcherText || !modelText) {
			if (!query || query.trim() === '') {
				return res.status(400).json({ error: 'Query is required when researcher/model texts are not provided' });
			}

			// Generate researcher-style analysis if missing
			if (!researcherText) {
				const researcherPrompt = `${researcherSystemPrompt}\n\n${dataSummary}\n\nUser Query: ${query}`;
				const researcherResult = await tryGenerate(genAI, researcherPrompt);
				researcherText = researcherResult.text;
			}

			// Generate model-style analysis if missing
			if (!modelText) {
				const modelPrompt = `${modelSystemPrompt}\n\n${dataSummary}\n\nUser Query: ${query}`;
				const modelResult = await tryGenerate(genAI, modelPrompt);
				modelText = modelResult.text;
			}
		}

		// Synthesize final coach-style conclusion using both provided/generated texts
		// Add consistency instructions to the synthesis prompt
		const synthPrompt = `You are a concise coach summarizer. Given the below two analyses, produce a single clear coach-style conclusion.\n\nResearcher analysis (human):\n${researcherText}\n\nModel analysis (AI):\n${modelText}\n\nInstructions for synthesis:\n- Start with a one-line \"Play Assessment:\" that restates the user's question succinctly.\n- Provide a short combined summary (3 bullet points) that draws together the key evidence from both analyses.\n- Give a clear \"Coach's Decision:\" that is either \"This is a good play\" or \"This is not a good play\" (or close variant).\n- The Coach's Decision should be consistent with the majority verdict of the researcher and model analyses. If both say good play, coach should say good play. If both say bad play, coach should say bad play. If they disagree, use the evidence and data to pick the most supported verdict, and explain briefly.\n- Add 2 brief actionable recommendations (what to do next or how to mitigate risks).\n- Keep everything concise and direct (max ~250 words).\n\nNow produce the conclusion.`;

		const synthResult = await tryGenerate(genAI, synthPrompt);

		res.json({
			response: synthResult.text,
			researcher: researcherText,
			model: modelText
		});
	} catch (error) {
		console.error('Error generating conclusion:', error);
		let statusCode = 500;
		let errorMessage = 'Failed to generate conclusion';
		let errorDetails = error.message || 'Unknown error';
		res.status(statusCode).json({ error: errorMessage, details: errorDetails });
	}
}

module.exports = { getConclusion };
