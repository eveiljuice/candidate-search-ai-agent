// OpenAI Tool definitions for function calling
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a URL in the browser',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to navigate to (must be a valid URL)',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click on an interactive element by its reference ID',
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            description: 'The reference ID of the element (e.g., "link_5", "btn_2")',
          },
        },
        required: ['ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into an input or textarea field',
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            description: 'The reference ID of the input element',
          },
          text: {
            type: 'string',
            description: 'The text to type',
          },
          pressEnter: {
            type: 'boolean',
            description: 'Whether to press Enter after typing (default: false)',
          },
        },
        required: ['ref', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page up or down',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down'],
            description: 'Direction to scroll',
          },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_context',
      description: 'Get the current page URL, title, and list of interactive elements with their reference IDs. Call this before interacting with elements.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_candidates',
      description: 'Extract developer profiles/candidates from the current page using semantic analysis. Works on profile pages, search results, or directory listings across any platform.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_profile_deep',
      description: 'Activate sub-agent to deeply scan a profile page. The sub-agent will navigate through tabs, extract social links, and create a TL;DR summary. Use this on individual profile pages to gather comprehensive data.',
      parameters: {
        type: 'object',
        properties: {
          profileUrl: {
            type: 'string',
            description: 'The URL of the profile page to scan',
          },
          username: {
            type: 'string',
            description: 'The username of the profile being scanned',
          },
        },
        required: ['profileUrl', 'username'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_complete',
      description: 'Mark the task as complete and return the found candidates',
      parameters: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            description: 'Array of found candidates',
            items: {
              type: 'object',
              properties: {
                username: { type: 'string' },
                profileUrl: { type: 'string' },
                name: { type: 'string' },
                bio: { type: 'string' },
                location: { type: 'string' },
                topLanguages: {
                  type: 'array',
                  items: { type: 'string' },
                },
                repos: { type: 'number' },
                followers: { type: 'number' },
                matchReason: { type: 'string' },
                // New enhanced fields
                socialLinks: {
                  type: 'object',
                  description: 'Social links object with properties: github, twitter, linkedin, website, email, telegram, discord, etc.',
                  properties: {
                    github: { type: 'string' },
                    twitter: { type: 'string' },
                    linkedin: { type: 'string' },
                    website: { type: 'string' },
                    email: { type: 'string' },
                    telegram: { type: 'string' },
                    discord: { type: 'string' },
                    stackoverflow: { type: 'string' },
                    medium: { type: 'string' },
                    dev: { type: 'string' },
                    youtube: { type: 'string' },
                  },
                },
                website: { type: 'string', description: 'Personal website URL' },
                tldrSummary: { type: 'string', description: 'TL;DR summary from sub-agent scan (2-4 sentences)' },
                company: { type: 'string' },
                hireable: { type: 'boolean' },
                skills: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of skills/technologies',
                },
              },
              required: ['username', 'profileUrl', 'matchReason'],
            },
          },
          summary: {
            type: 'string',
            description: 'Summary of the search process and results',
          },
        },
        required: ['candidates', 'summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Ask the user a clarifying question when more information is needed',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_confirmation',
      description: 'Request user confirmation before performing potentially destructive or sensitive actions (e.g., submitting forms, making purchases, deleting items, sending messages)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Clear description of the action you want to perform',
          },
          reason: {
            type: 'string',
            description: 'Why this action requires confirmation',
          },
          impact: {
            type: 'string',
            description: 'Potential consequences or side effects of this action',
          },
        },
        required: ['action', 'reason', 'impact'],
      },
    },
  },
];
