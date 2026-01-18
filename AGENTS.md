# AGENTS.md

## Project Overview

Browser Candidate Search Agent - an autonomous AI agent that searches for developers across any platform using natural language queries. The agent opens a visible browser and navigates websites autonomously using OpenAI's function calling with built-in security layer.

### Tech Stack

- TypeScript + Node.js 20+
- Playwright (headed mode, NOT headless)
- OpenAI SDK (o3-mini reasoning model)
- readline + chalk for terminal UI

### Architecture

```
src/
├── agent/
│   ├── coordinator.ts   # Main agent loop with OpenAI integration
│   ├── sub-agent.ts     # Profile Scanner sub-agent for deep profile analysis
│   ├── tools.ts         # Tool definitions for function calling
│   └── prompts.ts       # System prompt for the agent
├── browser/
│   ├── controller.ts    # Playwright wrapper with retry logic
│   └── extractor.ts     # DOM compression → PageContext + social links extraction
├── types.ts             # Type definitions (Candidate, SocialLinks, ProfileScanResult)
├── utils/
│   └── spinner.ts       # Terminal animation utilities
└── index.ts             # Entry point + readline interface
```

## Dev Environment Tips

### Prerequisites

- Node.js 20+
- OpenAI API key

### Setup

```bash
npm install
npx playwright install chromium
```

### Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
# Edit .env and add your OpenAI API key
```

Required variables:

- `OPENAI_API_KEY` - Your OpenAI API key (sk-...)

## Build & Run Commands

```bash
# Development - normal mode (recommended)
npm start
# or
npm run dev

# Build TypeScript
npm run build

# Run built version
node dist/index.js

# Alternative: run with inline env var (PowerShell)
$env:OPENAI_API_KEY="sk-xxx"; npx tsx src/index.ts

# Alternative: run with inline env var (bash)
OPENAI_API_KEY=sk-xxx npx tsx src/index.ts
```

⚠️ **ВАЖНО:**

- `npm run dev` использует `tsx` БЕЗ watch режима
- `npm run dev:watch` использует watch, но stdin будет заблокирован (используйте только для проверки кода без интерактива)
- Для интерактивной работы всегда используйте `npm start` или `npm run dev`

### Understanding Terminal Output

When the agent runs, you'll see structured output showing its reasoning process:

```
════════════════════════════════════════════════════════════════════════════════
[Iteration 1]
════════════════════════════════════════════════════════════════════════════════

⠋ 🤔 Reading page context...
⠙ 🧠 Analyzing available options...
⠹ 💭 Considering alternatives...
⠸ 🎯 Deciding on best approach...
✓ Agent has formulated response

💭 Agent Thinking Process:
┌──────────────────────────────────────────────────────────────────────────────┐
│ INTERNAL REASONING:
│ - Current state: On developer platform homepage, need to find backend developers
│ - Goal: Navigate to search page and explore available filters
│ - Discovery: Site has main search bar and advanced search option
│ - Options: Could use quick search OR advanced search with filters
│ - Decision: Navigate to search interface to inspect available options
└──────────────────────────────────────────────────────────────────────────────┘

🎯 Planned Action: Calling navigate() to go to platform search page

🛠️  Executing 1 tool call(s):
  🔧 navigate {"url": "https://example.com/search"}
  ⠋ 🌐 Navigating to page...
     ✓ Navigated to https://example.com/search

📊 Token usage: 245 prompt + 87 completion + 0 reasoning = 332 total

⏳ Pausing for analysis... (2000ms)
```

**Terminal indicators:**

- **Animated spinners** (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) - Agent is thinking/processing
  - Shows during OpenAI API calls with cycling stage messages
  - Shows during tool execution (navigation, clicking, extraction)
  - Makes thinking process visible and engaging
- `💭 Agent Thinking Process` - Step-by-step reasoning using structured format
  - Agent explains current situation, goal, discovery, options, and decision
  - Shows 5 required sections: Current state → Goal → Discovery → Options → Decision
- `🎯 Planned Action` - What the agent will do next
- `🛠️ Executing N tool call(s)` - Actions being taken
- `⚠️ Warning` - Agent called tools without showing reasoning (should not happen)
- `✓` - Success (green checkmark)
- `✗` - Error (red X) - agent will analyze and adapt
- `📊 Token usage` - Shows prompt, completion, and reasoning tokens used
- `⏳ Pausing for analysis` - Agent is reflecting on results
- After errors: 4-second pause for deeper analysis

**Thinking animations:**

- `🤔 Reading page context...` - Initial analysis
- `🧠 Analyzing available options...` - Evaluating choices
- `💭 Considering alternatives...` - Weighing different approaches
- `🎯 Deciding on best approach...` - Making decision
- `✨ Planning next action...` - Formulating plan
- Tool-specific: `🌐 Navigating...`, `👆 Clicking...`, `⌨️ Typing...`, `🔍 Extracting...`

**Note on Reasoning Visibility:**

- OpenAI's Chat Completions API does not expose internal reasoning tokens from o3-mini
- Instead, agent is REQUIRED to "think out loud" using structured 🧠 REASONING format
- Agent MUST explain its reasoning before EVERY tool call in message content
- System prompt enforces this with examples and strong warnings
- Coordinator displays warnings if agent skips reasoning
- This makes the decision-making process fully transparent and debuggable

**Sub-Agent indicators (Profile Scanner):**

```
┌─────────────────────────────────────────────────────────┐
│ 🤖 SUB-AGENT ACTIVATED: Profile Scanner                │
│ Target: username                                        │
└─────────────────────────────────────────────────────────┘
  [Sub-agent iteration 1/15]
    → extract_profile_data {}
    → click {"ref": "tab_1"}
    → scroll {"direction": "down"}
    → complete_scan {"socialLinks": {...}, "tldrSummary": "..."}
┌─────────────────────────────────────────────────────────┐
│ ✅ SUB-AGENT SCAN COMPLETE                              │
└─────────────────────────────────────────────────────────┘
  📱 Social Links Found:
     twitter: https://twitter.com/username
     website: https://example.com
  📝 TL;DR Summary:
     Backend engineer focused on Go and distributed systems...
```

## Key Design Decisions

### AI Model Configuration

- Uses **OpenAI o3-mini** - reasoning model optimized for STEM tasks (coding, math, logic)
- **reasoning_effort: "medium"** - balanced approach between speed and reasoning quality
- Supports function calling with structured tool definitions
- ~24% faster than o1-mini while matching o1 performance on coding benchmarks
- **Extended iterations**: Up to 500 iterations (vs previous 50) to allow thorough exploration
- **Reflection pauses**: 2-second pause between iterations for analysis, 4 seconds after errors
- **Reasoning display**: Internal reasoning process visible in terminal output

### Sub-Agent Architecture (Profile Scanner)

The main agent can activate a specialized sub-agent for deep profile scanning:

- **Purpose**: Thoroughly scan individual profile pages to extract maximum data
- **Model**: Uses `gpt-4o-mini` for faster execution (sub-agent needs speed, not deep reasoning)
- **Max iterations**: 15 (focused task, doesn't need extensive exploration)
- **Capabilities**:
  - Extracts ALL social links (GitHub, Twitter, LinkedIn, website, email, Telegram, Discord, etc.)
  - Navigates through profile tabs (Repositories, Projects, Stars, etc.)
  - Scrolls to find hidden content
  - Generates TL;DR summary (2-4 sentences about the person)
- **Output**: Returns `ProfileScanResult` with `socialLinks`, `tldrSummary`, and `additionalData`
- **Terminal visibility**: Shows activation banner, iteration progress, and final results

### System Prompt Design

Following OpenAI's prompt engineering best practices:

- Structured format with clear sections (Role → Tools → Strategy → Rules)
- Explicit instructions with concrete examples and expected formats
- Markdown delimiters for readability and maintainability
- Emphasis on verified data over inference (no hallucinations)
- Progressive decision-making framework with error recovery protocols
- **Platform-agnostic**: Agent discovers website UI dynamically, no hardcoded assumptions
- **Failure analysis**: Agent must analyze WHY failures happen, not just retry
- **Transparent reasoning**: Agent explains its thinking before each action
- **Quality over speed**: Agent prioritizes finding the RIGHT candidates, not rushing
- **Security layer**: Agent requests confirmation for destructive/sensitive actions

### Context Management

- DOM is NOT sent raw to the LLM
- `extractor.ts` compresses page to interactive elements only
- Each element gets a short ref ID (link_1, btn_2, input_3)
- Max 150 elements per page context
- **Universal extraction**: Uses semantic analysis (schema.org, structural patterns, content analysis)
- **No hardcoded selectors**: Agent works with any platform, not just specific sites

### Error Handling

- Retry logic with 3 attempts per action
- Fallback to force-click if normal click fails
- Agent receives error messages to self-correct

### Persistent Sessions

- Browser data stored in `.browser-data/`
- Allows manual login on any platform with persistent sessions
- User can login once, sessions saved for future runs
- Uses `launchPersistentContext()` with proper args for keyboard input
- `bypassCSP: true` enables reliable text input across all pages

### Security Layer

- `request_confirmation()` tool for sensitive actions
- Required before: purchases, deletions, form submissions, sending messages
- User sees: action description, reason, potential impact
- Agent must get explicit approval before proceeding
- Prevents accidental destructive operations

### Enhanced Candidate Output

Each candidate in the final results includes:

```typescript
interface Candidate {
  // Required fields
  username: string;
  profileUrl: string;
  matchReason: string;
  
  // Basic profile data
  name?: string;
  bio?: string;
  location?: string;
  company?: string;
  topLanguages: string[];
  repos?: number;
  followers?: number;
  hireable?: boolean;
  skills?: string[];
  
  // Enhanced fields (from sub-agent scan)
  socialLinks?: {
    github?: string;
    twitter?: string;
    linkedin?: string;
    website?: string;
    email?: string;
    telegram?: string;
    discord?: string;
    stackoverflow?: string;
    medium?: string;
    dev?: string;
    youtube?: string;
  };
  website?: string;
  tldrSummary?: string;  // TL;DR from sub-agent (2-4 sentences)
}
```

## Code Style Guidelines

### TypeScript

- Strict mode enabled
- Use ES modules (import/export)
- Suffix imports with `.js` for ES module resolution
- Prefer interfaces over types for objects

### Naming

- Files: kebab-case (e.g., `coordinator.ts`)
- Classes: PascalCase (e.g., `BrowserController`)
- Functions/variables: camelCase (e.g., `extractPageContext`)
- Tool names: snake_case (e.g., `get_page_context`)

### Error Handling

- Return `ToolResult` with `success` boolean
- Include human-readable `error` message
- Log errors with chalk colors

## Git & PR Instructions

### Branch naming

- `feature/description`
- `fix/description`

### Commit format

```
type: short description

- Detail 1
- Detail 2
```

Types: feat, fix, refactor, docs, chore
