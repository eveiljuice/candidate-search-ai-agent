// Main agent coordinator - handles OpenAI communication and tool execution
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { BrowserController } from '../browser/controller.js';
import { AGENT_TOOLS } from './tools.js';
import { SYSTEM_PROMPT, formatTaskPrompt } from './prompts.js';
import { ProfileScannerSubAgent } from './sub-agent.js';
import type {
  TaskResult,
  Candidate,
  NavigateArgs,
  ClickArgs,
  TypeTextArgs,
  ScrollArgs,
  TaskCompleteArgs,
  AskUserArgs,
  RequestConfirmationArgs,
  ScanProfileArgs,
  PageContext
} from '../types.js';
import chalk from 'chalk';
import type * as readline from 'readline/promises';
import { DetailedThinkingAnimation } from '../utils/spinner.js';

const MAX_ITERATIONS = 500; // Allow extended reasoning and exploration
const THINKING_PAUSE_MS = 2000; // Pause between iterations for reflection

export class AgentCoordinator {
  private openai: OpenAI;
  private browser: BrowserController;
  private messages: ChatCompletionMessageParam[] = [];
  private rl: readline.Interface;
  private taskComplete: boolean = false;
  private taskResult: TaskResult | null = null;
  private subAgent: ProfileScannerSubAgent | null = null;

  constructor(rl: readline.Interface) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({ apiKey });
    this.browser = new BrowserController();
    this.rl = rl;
  }

  async initialize(): Promise<void> {
    console.log(chalk.blue('🚀 Initializing browser...'));
    await this.browser.initialize();
    console.log(chalk.green('✓ Browser ready'));
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  async runTask(task: string): Promise<TaskResult> {
    this.taskComplete = false;
    this.taskResult = null;

    // Initialize messages with system prompt and task
    this.messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: formatTaskPrompt(task) },
    ];

    console.log(chalk.cyan('\n📋 Task received:'), task);
    console.log(chalk.gray('─'.repeat(50)));

    let iteration = 0;

    while (!this.taskComplete && iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(chalk.gray(`\n${'═'.repeat(80)}`));
      console.log(chalk.bold.cyan(`[Iteration ${iteration}]`));
      console.log(chalk.gray('═'.repeat(80)) + '\n');

      try {
        await this.executeStep();

        // Pause for reflection between iterations (unless task is complete)
        if (!this.taskComplete) {
          console.log(chalk.gray(`\n⏳ Pausing for analysis... (${THINKING_PAUSE_MS}ms)`));
          await new Promise(resolve => setTimeout(resolve, THINKING_PAUSE_MS));
        }
      } catch (error) {
        console.error(chalk.red('\n❌ Error in agent step:'), error);
        console.log(chalk.yellow('🤔 Agent will analyze this error and adapt strategy...\n'));

        // Add error to context so agent can analyze it
        this.messages.push({
          role: 'user',
          content: `System error occurred: ${error}. 

Please analyze why this error happened and what it tells you about the current situation. Then decide on the best alternative approach. Don't just retry - think about what went wrong and how to avoid it.`,
        });

        // Longer pause after errors for deeper reflection
        await new Promise(resolve => setTimeout(resolve, THINKING_PAUSE_MS * 2));
      }
    }

    if (!this.taskResult) {
      return {
        success: false,
        candidates: [],
        summary: `Task did not complete within ${MAX_ITERATIONS} iterations.`,
      };
    }

    return this.taskResult;
  }

  private async executeStep(): Promise<void> {
    // Show thinking animation while waiting for OpenAI response
    const thinkingAnimation = new DetailedThinkingAnimation();
    thinkingAnimation.start();

    let response;
    try {
      // Call OpenAI with o3-mini reasoning model
      // reasoning_effort: controls reasoning depth ('low' | 'medium' | 'high')
      // - low: faster, simpler reasoning
      // - medium: balanced (default)
      // - high: slower but more thorough reasoning
      response = await this.openai.chat.completions.create({
        model: 'o3-mini',
        messages: this.messages,
        tools: AGENT_TOOLS,
        tool_choice: 'auto',
        reasoning_effort: 'medium' as 'low' | 'medium' | 'high',
      });

      // Stop animation on success - don't print message, reasoning will be shown below
      thinkingAnimation.stop();
    } catch (error) {
      thinkingAnimation.fail('Failed to get response from OpenAI');
      throw error;
    }

    const choice = response.choices[0];
    const message = choice.message;

    // Display internal reasoning/chain-of-thought if available
    // o3-mini returns reasoning tokens that show the model's thinking process
    const messageWithReasoning = message as any;

    if (messageWithReasoning.reasoning) {
      console.log(chalk.blue('\n💭 Internal Reasoning (Chain-of-Thought):'));
      console.log(chalk.gray('─'.repeat(80)));
      console.log(chalk.cyan(messageWithReasoning.reasoning));
      console.log(chalk.gray('─'.repeat(80)));
    }

    // Also check for reasoning_content (alternative field name)
    if ((choice as any).reasoning_content) {
      console.log(chalk.blue('\n💭 Reasoning Content:'));
      console.log(chalk.gray('─'.repeat(80)));
      console.log(chalk.cyan((choice as any).reasoning_content));
      console.log(chalk.gray('─'.repeat(80)));
    }

    // Display usage statistics including reasoning tokens
    if (response.usage) {
      const usage = response.usage as any;
      if (usage.reasoning_tokens) {
        console.log(chalk.gray(`\n📊 Token usage: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion + ${usage.reasoning_tokens} reasoning = ${usage.total_tokens} total`));
      }
    }

    // Add assistant message to history
    this.messages.push(message as ChatCompletionMessageParam);

    // Display agent's thinking and decision
    if (message.content) {
      // Check if content contains structured reasoning format
      const content = message.content;

      if (content.includes('🧠 REASONING:')) {
        // Parse and display structured reasoning
        const parts = content.split('ACTION:');
        const reasoningPart = parts[0];
        const actionPart = parts[1] || '';

        console.log(chalk.blue('\n💭 Agent Thinking Process:'));
        console.log(chalk.gray('┌' + '─'.repeat(78) + '┐'));

        // Display reasoning with proper formatting
        const reasoningLines = reasoningPart.split('\n').filter(l => l.trim());
        for (const line of reasoningLines) {
          if (line.includes('🧠 REASONING:')) {
            console.log(chalk.gray('│ ') + chalk.bold.cyan('INTERNAL REASONING:'));
          } else if (line.trim().startsWith('-')) {
            // Highlight each reasoning point
            console.log(chalk.gray('│ ') + chalk.cyan(line));
          } else {
            console.log(chalk.gray('│ ') + chalk.cyan(line));
          }
        }

        console.log(chalk.gray('└' + '─'.repeat(78) + '┘'));

        if (actionPart.trim()) {
          console.log(chalk.yellow('\n🎯 Planned Action:'), chalk.white(actionPart.trim()));
        }
      } else {
        // Fallback for non-structured content
        console.log(chalk.yellow('\n🤖 Agent Response:'), message.content);
      }
    }

    // Process tool calls if any
    if (message.tool_calls && message.tool_calls.length > 0) {
      console.log(chalk.magenta(`\n🛠️  Executing ${message.tool_calls.length} tool call(s):`));
      for (const toolCall of message.tool_calls) {
        await this.executeTool(toolCall);
      }
    } else if (!message.content) {
      console.log(chalk.gray('\n(No action taken this iteration)'));
    }
  }

  private async executeTool(toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall): Promise<void> {
    const { name, arguments: argsStr } = toolCall.function;
    let args: Record<string, unknown>;

    try {
      args = JSON.parse(argsStr);
    } catch {
      args = {};
    }

    console.log(chalk.magenta(`  🔧 ${name}`), chalk.gray(JSON.stringify(args)));

    let result: string;

    // Show mini spinner for tool execution (except for quick operations)
    const shouldShowSpinner = !['task_complete', 'ask_user', 'request_confirmation'].includes(name);
    let toolSpinner: DetailedThinkingAnimation | null = null;

    if (shouldShowSpinner) {
      toolSpinner = new DetailedThinkingAnimation();
      const actionText = this.getToolActionText(name);
      // Use simple start without cycling stages for tool execution
      (toolSpinner as any).spinner.start(actionText);
    }

    try {
      switch (name) {
        case 'navigate':
          result = await this.handleNavigate(args as unknown as NavigateArgs);
          break;
        case 'click':
          result = await this.handleClick(args as unknown as ClickArgs);
          break;
        case 'type_text':
          result = await this.handleTypeText(args as unknown as TypeTextArgs);
          break;
        case 'scroll':
          result = await this.handleScroll(args as unknown as ScrollArgs);
          break;
        case 'get_page_context':
          result = await this.handleGetPageContext();
          break;
        case 'extract_candidates':
          result = await this.handleExtractCandidates();
          break;
        case 'task_complete':
          result = await this.handleTaskComplete(args as unknown as TaskCompleteArgs);
          break;
        case 'ask_user':
          result = await this.handleAskUser(args as unknown as AskUserArgs);
          break;
        case 'request_confirmation':
          result = await this.handleRequestConfirmation(args as unknown as RequestConfirmationArgs);
          break;
        case 'scan_profile_deep':
          result = await this.handleScanProfileDeep(args as unknown as ScanProfileArgs);
          break;
        default:
          result = JSON.stringify({ error: `Unknown tool: ${name}` });
      }

      // Stop spinner on success
      if (toolSpinner) {
        toolSpinner.stop();
      }
    } catch (error) {
      // Stop spinner on error
      if (toolSpinner) {
        toolSpinner.fail(`Failed to execute ${name}`);
      }
      result = JSON.stringify({ error: `Tool execution failed: ${error}` });
    }

    // Add tool result to messages
    this.messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: result,
    });

    // Log abbreviated result
    const resultObj = JSON.parse(result);
    if (resultObj.success) {
      console.log(chalk.green('     ✓'), chalk.gray(this.abbreviateResult(resultObj)));
    } else {
      console.log(chalk.red('     ✗ Error:'), chalk.yellow(resultObj.error));
      console.log(chalk.gray('     Agent should analyze this failure...'));
    }
  }

  private abbreviateResult(result: Record<string, unknown>): string {
    if (result.data && typeof result.data === 'object') {
      const data = result.data as Record<string, unknown>;
      if (data.elements && Array.isArray(data.elements)) {
        return `Page context: ${data.url} (${data.elements.length} elements)`;
      }
      if (data.candidates && Array.isArray(data.candidates)) {
        return `Found ${data.candidates.length} candidates`;
      }
    }
    const str = JSON.stringify(result.data || result);
    return str.length > 100 ? str.slice(0, 100) + '...' : str;
  }

  private getToolActionText(toolName: string): string {
    const actionTexts: Record<string, string> = {
      navigate: '🌐 Navigating to page...',
      click: '👆 Clicking element...',
      type_text: '⌨️  Typing text...',
      scroll: '📜 Scrolling page...',
      get_page_context: '🔍 Extracting page elements...',
      extract_candidates: '📊 Extracting candidate data...',
      scan_profile_deep: '🤖 Activating sub-agent for deep profile scan...',
    };
    return actionTexts[toolName] || `⚙️  Executing ${toolName}...`;
  }

  // === Tool handlers ===

  private async handleNavigate(args: NavigateArgs): Promise<string> {
    const result = await this.browser.navigate(args.url);
    return JSON.stringify(result);
  }

  private async handleClick(args: ClickArgs): Promise<string> {
    const result = await this.browser.click(args.ref);
    return JSON.stringify(result);
  }

  private async handleTypeText(args: TypeTextArgs): Promise<string> {
    const result = await this.browser.typeText(args.ref, args.text, args.pressEnter);
    return JSON.stringify(result);
  }

  private async handleScroll(args: ScrollArgs): Promise<string> {
    const result = await this.browser.scroll(args.direction);
    return JSON.stringify(result);
  }

  private async handleGetPageContext(): Promise<string> {
    const result = await this.browser.getPageContext();

    if (result.success && result.data) {
      const context = result.data as PageContext;
      // Format for LLM - don't include selectors
      const formatted = {
        success: true,
        data: {
          url: context.url,
          title: context.title,
          elements: context.elements.map((el) => ({
            ref: el.ref,
            type: el.type,
            text: el.text,
            ...(el.href ? { href: el.href.slice(0, 100) } : {}),
          })),
        },
      };
      return JSON.stringify(formatted);
    }

    return JSON.stringify(result);
  }

  private async handleExtractCandidates(): Promise<string> {
    const result = await this.browser.extractCandidates();
    return JSON.stringify(result);
  }

  private async handleTaskComplete(args: TaskCompleteArgs): Promise<string> {
    this.taskComplete = true;
    this.taskResult = {
      success: true,
      candidates: args.candidates,
      summary: args.summary,
    };

    console.log(chalk.green('\n✅ Task completed!'));
    return JSON.stringify({ success: true, message: 'Task marked as complete' });
  }

  private async handleAskUser(args: AskUserArgs): Promise<string> {
    console.log(chalk.yellow('\n❓ Agent asks:'), args.question);

    const answer = await this.rl.question(chalk.cyan('Your answer: '));

    return JSON.stringify({ success: true, answer });
  }

  private async handleRequestConfirmation(args: RequestConfirmationArgs): Promise<string> {
    console.log(chalk.red('\n⚠️  CONFIRMATION REQUIRED'));
    console.log(chalk.yellow('Action:'), args.action);
    console.log(chalk.yellow('Reason:'), args.reason);
    console.log(chalk.yellow('Impact:'), args.impact);
    console.log(chalk.gray('─'.repeat(50)));

    const response = await this.rl.question(chalk.cyan('Proceed? (yes/no): '));
    const confirmed = response.trim().toLowerCase() === 'yes';

    if (confirmed) {
      console.log(chalk.green('✓ User approved action'));
      return JSON.stringify({ success: true, confirmed: true, message: 'User approved. You may proceed with the action.' });
    } else {
      console.log(chalk.red('✗ User rejected action'));
      return JSON.stringify({ success: false, confirmed: false, message: 'User rejected. Do not proceed. Consider alternative approaches.' });
    }
  }

  private async handleScanProfileDeep(args: ScanProfileArgs): Promise<string> {
    // Initialize sub-agent if needed
    if (!this.subAgent) {
      this.subAgent = new ProfileScannerSubAgent(this.browser);
    }

    try {
      const scanResult = await this.subAgent.scanProfile(args.profileUrl, args.username);

      // Display sub-agent results summary
      console.log(chalk.magenta('\n┌─────────────────────────────────────────────────────────┐'));
      console.log(chalk.magenta('│') + chalk.bold.green(' ✅ SUB-AGENT SCAN COMPLETE') + chalk.magenta('                              │'));
      console.log(chalk.magenta('└─────────────────────────────────────────────────────────┘'));

      // Show social links found
      const socialKeys = Object.keys(scanResult.socialLinks).filter(k => (scanResult.socialLinks as any)[k]);
      if (socialKeys.length > 0) {
        console.log(chalk.cyan('  📱 Social Links Found:'));
        socialKeys.forEach(key => {
          const value = (scanResult.socialLinks as any)[key];
          if (value) {
            console.log(chalk.gray(`     ${key}: `) + chalk.white(value.slice(0, 50) + (value.length > 50 ? '...' : '')));
          }
        });
      }

      // Show TL;DR
      if (scanResult.tldrSummary) {
        console.log(chalk.cyan('\n  📝 TL;DR Summary:'));
        console.log(chalk.white(`     ${scanResult.tldrSummary}`));
      }

      return JSON.stringify({
        success: true,
        data: {
          socialLinks: scanResult.socialLinks,
          tldrSummary: scanResult.tldrSummary,
          additionalData: scanResult.additionalData,
        },
      });
    } catch (error) {
      console.log(chalk.red('  ✗ Sub-agent scan failed:'), error);
      return JSON.stringify({
        success: false,
        error: `Sub-agent scan failed: ${error}`,
      });
    }
  }
}
