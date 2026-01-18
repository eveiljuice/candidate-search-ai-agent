// Sub-agent for deep profile scanning
// Explores profile pages thoroughly - navigates tabs, scrolls, extracts all data
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { BrowserController } from '../browser/controller.js';
import { extractSocialLinks, extractProfileTabs, extractDetailedProfileInfo, getPageTextSummary } from '../browser/extractor.js';
import type { ProfileScanResult, SocialLinks } from '../types.js';
import chalk from 'chalk';
import { DetailedThinkingAnimation } from '../utils/spinner.js';

const SUB_AGENT_MAX_ITERATIONS = 15; // Limit iterations for sub-agent

const SUB_AGENT_SYSTEM_PROMPT = `# Role: Profile Scanner Sub-Agent

You are a specialized sub-agent focused on deeply scanning a user profile page to extract maximum information.

## Your Mission
1. Extract ALL social links and contact info (GitHub, Twitter, LinkedIn, website, email, etc.)
2. Navigate through profile tabs (Repositories, Projects, Stars, etc.) to understand the user
3. Create a TL;DR summary of the person's profile

## Available Tools
- \`get_page_context()\` - Get current page elements
- \`click(ref)\` - Click on elements (use for tabs)
- \`scroll(direction)\` - Scroll to see more content ("up" or "down")
- \`extract_profile_data()\` - Extract social links, tabs, and detailed info
- \`complete_scan(socialLinks, tldrSummary, additionalData)\` - Finish scanning and return results

## Strategy
1. First, call \`extract_profile_data()\` to get initial data
2. Look at available tabs on the profile (Repositories, Overview, Projects, etc.)
3. Visit 2-3 most relevant tabs to understand the person better
4. Scroll through content to find social links, bio info, pinned projects
5. Create a concise TL;DR (2-4 sentences) summarizing:
   - What they do (role/focus)
   - Key technologies/skills
   - Notable achievements or projects
   - Contact availability

## TL;DR Format Example
"Backend engineer at Company X, focused on distributed systems and Go/Rust. Maintains popular open-source project Y with 5k+ stars. Active contributor with 2000+ contributions. Available via email and Twitter."

## Rules
- Be thorough but efficient - you have limited iterations
- Don't repeat actions - if you scrolled, move to next task
- Always call \`complete_scan()\` when done
- Don't make up information - only report what you actually see
`;

interface SubAgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export class ProfileScannerSubAgent {
  private openai: OpenAI;
  private browser: BrowserController;
  private scanComplete: boolean = false;
  private scanResult: ProfileScanResult | null = null;

  constructor(browser: BrowserController) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({ apiKey });
    this.browser = browser;
  }

  /**
   * Scan a profile page deeply and return structured data
   */
  async scanProfile(profileUrl: string, username: string): Promise<ProfileScanResult> {
    this.scanComplete = false;
    this.scanResult = null;

    console.log(chalk.magenta('\n┌─────────────────────────────────────────────────────────┐'));
    console.log(chalk.magenta('│') + chalk.bold.cyan(' 🤖 SUB-AGENT ACTIVATED: Profile Scanner') + chalk.magenta('                │'));
    console.log(chalk.magenta('│') + chalk.gray(` Target: ${username.slice(0, 45).padEnd(45)}`) + chalk.magenta('   │'));
    console.log(chalk.magenta('└─────────────────────────────────────────────────────────┘'));

    // Navigate to profile if not already there
    const currentUrl = await this.browser.navigate(profileUrl);
    if (!currentUrl.success) {
      console.log(chalk.red('  ✗ Sub-agent: Failed to navigate to profile'));
      return {
        success: false,
        profileUrl,
        socialLinks: {},
        tldrSummary: 'Failed to scan profile - navigation error',
      };
    }

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Scan this profile thoroughly: ${profileUrl}\nUsername: ${username}\n\nStart by extracting profile data, then explore tabs and create a TL;DR summary.`
      },
    ];

    let iteration = 0;

    while (!this.scanComplete && iteration < SUB_AGENT_MAX_ITERATIONS) {
      iteration++;
      console.log(chalk.gray(`  [Sub-agent iteration ${iteration}/${SUB_AGENT_MAX_ITERATIONS}]`));

      try {
        const response = await this.executeSubAgentStep(messages);

        if (response.tool_calls && response.tool_calls.length > 0) {
          messages.push(response as ChatCompletionMessageParam);

          for (const toolCall of response.tool_calls) {
            const result = await this.executeSubAgentTool(toolCall);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          }
        } else if (response.content) {
          console.log(chalk.gray(`  Sub-agent: ${response.content.slice(0, 100)}...`));
          messages.push(response as ChatCompletionMessageParam);
        }

      } catch (error) {
        console.log(chalk.yellow(`  Sub-agent error: ${error}`));
        break;
      }
    }

    if (!this.scanResult) {
      // Fallback: extract basic data if sub-agent didn't complete properly
      console.log(chalk.yellow('  Sub-agent: Using fallback extraction'));
      const socialLinks = await this.browser.extractSocialLinks();
      const pageTextResult = await this.browser.getPageTextSummary();
      const pageText = pageTextResult.success ? (pageTextResult.data as string) : '';

      this.scanResult = {
        success: true,
        profileUrl,
        socialLinks: socialLinks.success ? (socialLinks.data as SocialLinks) : {},
        tldrSummary: `Profile scanned (fallback): ${pageText?.slice(0, 200)}...`,
      };
    }

    console.log(chalk.magenta('  └─ Sub-agent scan complete'));
    console.log(chalk.cyan(`     TL;DR: ${this.scanResult.tldrSummary?.slice(0, 80)}...`));

    return this.scanResult;
  }

  private async executeSubAgentStep(messages: ChatCompletionMessageParam[]): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
    const spinner = new DetailedThinkingAnimation();
    (spinner as any).spinner.start(chalk.gray('  🔍 Sub-agent analyzing...'));

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // Use faster model for sub-agent
        messages,
        tools: this.getSubAgentTools(),
        tool_choice: 'auto',
      });

      spinner.stop();
      return response.choices[0].message;
    } catch (error) {
      spinner.fail('Sub-agent API error');
      throw error;
    }
  }

  private getSubAgentTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'get_page_context',
          description: 'Get interactive elements on the current page',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'click',
          description: 'Click on an element (use for navigating tabs)',
          parameters: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'Element reference ID' },
            },
            required: ['ref'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'scroll',
          description: 'Scroll the page',
          parameters: {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['up', 'down'] },
            },
            required: ['direction'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'extract_profile_data',
          description: 'Extract social links, tabs, and detailed profile info from current page',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'complete_scan',
          description: 'Complete the profile scan and return results',
          parameters: {
            type: 'object',
            properties: {
              socialLinks: {
                type: 'object',
                description: 'Object with social link URLs (github, twitter, linkedin, website, email, etc.)',
              },
              tldrSummary: {
                type: 'string',
                description: 'TL;DR summary of the profile (2-4 sentences)',
              },
              additionalData: {
                type: 'object',
                description: 'Additional extracted data (pinnedRepos, organizations, etc.)',
              },
            },
            required: ['socialLinks', 'tldrSummary'],
          },
        },
      },
    ];
  }

  private async executeSubAgentTool(toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall): Promise<unknown> {
    const { name, arguments: argsStr } = toolCall.function;
    let args: Record<string, unknown>;

    try {
      args = JSON.parse(argsStr);
    } catch {
      args = {};
    }

    console.log(chalk.gray(`    → ${name}`), chalk.dim(JSON.stringify(args).slice(0, 60)));

    switch (name) {
      case 'get_page_context':
        return await this.browser.getPageContext();

      case 'click':
        return await this.browser.click(args.ref as string);

      case 'scroll':
        return await this.browser.scroll(args.direction as 'up' | 'down');

      case 'extract_profile_data':
        return await this.extractProfileData();

      case 'complete_scan':
        return this.completeScan(
          args.socialLinks as SocialLinks,
          args.tldrSummary as string,
          args.additionalData as Record<string, unknown>
        );

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private async extractProfileData(): Promise<unknown> {
    const [socialLinks, tabs, detailedInfo, pageText] = await Promise.all([
      this.browser.extractSocialLinks(),
      this.browser.extractProfileTabs(),
      this.browser.extractDetailedProfileInfo(),
      this.browser.getPageTextSummary(),
    ]);

    return {
      success: true,
      socialLinks: socialLinks.success ? socialLinks.data : {},
      tabs: tabs.success ? tabs.data : [],
      detailedInfo: detailedInfo.success ? detailedInfo.data : {},
      pageTextPreview: pageText.success ? (pageText.data as string)?.slice(0, 500) : '',
    };
  }

  private completeScan(
    socialLinks: SocialLinks,
    tldrSummary: string,
    additionalData?: Record<string, unknown>
  ): unknown {
    this.scanComplete = true;
    this.scanResult = {
      success: true,
      profileUrl: '',
      socialLinks: socialLinks || {},
      tldrSummary: tldrSummary || 'No summary generated',
      additionalData: additionalData as ProfileScanResult['additionalData'],
    };

    return { success: true, message: 'Scan completed' };
  }
}
