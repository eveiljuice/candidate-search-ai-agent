#!/usr/bin/env node
// Entry point for the GitHub Candidate Search Agent
import 'dotenv/config';
import * as readline from 'readline/promises';
import chalk from 'chalk';
import { AgentCoordinator } from './agent/coordinator.js';

const BANNER = `
${chalk.blue('╔═══════════════════════════════════════════════════════╗')}
${chalk.blue('║')}  ${chalk.bold.white('Candidate Search Agent 👾')}                            ${chalk.blue('║')}
${chalk.blue('║')}  ${chalk.gray('Autonomous AI-powered developer search')}               ${chalk.blue('║')}
${chalk.blue('╚═══════════════════════════════════════════════════════╝')}
`;

const HELP = `
${chalk.yellow('Commands:')}
  ${chalk.cyan('search <query>')}  - Search for developers (e.g., "search 5 Go developers")
  ${chalk.cyan('exit / quit')}     - Exit the program
  ${chalk.cyan('help')}            - Show this message

${chalk.yellow('Example queries:')}
  • Find 5 Go-developers with experience in microservices
  • Search for 3 TypeScript developers with React experience in Berlin
  • Find 10 Python ML engineers with contributions to scikit-learn
`;

async function main() {
  console.log(BANNER);

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error(chalk.red('❌ Error: OPENAI_API_KEY not found'));
    console.log(chalk.gray('Create a .env file with: OPENAI_API_KEY=sk-xxx'));
    console.log(chalk.gray('Or run with: OPENAI_API_KEY=sk-xxx npx tsx src/index.ts'));
    process.exit(1);
  }

  // Ensure stdin is in the correct mode for interactive input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let agent: AgentCoordinator | null = null;

  const shutdown = async () => {
    console.log(chalk.gray('\n\nShutting down...'));
    if (agent) {
      await agent.close();
    }
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(HELP);

  // Main loop using async/await instead of callbacks
  while (true) {
    try {
      const input = await rl.question(chalk.green('\n> '));
      const trimmed = input.trim();

      if (!trimmed) {
        continue;
      }

      const lowerInput = trimmed.toLowerCase();

      // Handle commands
      if (lowerInput === 'exit' || lowerInput === 'quit') {
        await shutdown();
        break;
      }

      if (lowerInput === 'help') {
        console.log(HELP);
        continue;
      }

      // Treat everything else as a search task
      const task = trimmed.startsWith('search ')
        ? trimmed.slice(7)
        : trimmed;

      try {
        // Initialize agent if needed
        if (!agent) {
          agent = new AgentCoordinator(rl);
          await agent.initialize();
        }

        // Run the task
        const result = await agent.runTask(task);

        // Display results
        console.log(chalk.blue('\n' + '═'.repeat(50)));
        console.log(chalk.bold.white('📊 Results'));
        console.log(chalk.blue('═'.repeat(50)));

        if (result.success && result.candidates.length > 0) {
          result.candidates.forEach((candidate, i) => {
            console.log(chalk.cyan(`\n${i + 1}. ${candidate.username}`));
            console.log(chalk.gray(`   ${candidate.profileUrl}`));
            if (candidate.name) console.log(`   Name: ${candidate.name}`);
            if (candidate.bio) console.log(`   Bio: ${candidate.bio.slice(0, 100)}${candidate.bio.length > 100 ? '...' : ''}`);
            if (candidate.location) console.log(`   Location: ${candidate.location}`);
            if (candidate.company) console.log(`   Company: ${candidate.company}`);
            if (candidate.topLanguages && candidate.topLanguages.length > 0) {
              console.log(`   Languages: ${candidate.topLanguages.join(', ')}`);
            }
            if (candidate.skills && candidate.skills.length > 0) {
              console.log(`   Skills: ${candidate.skills.slice(0, 5).join(', ')}${candidate.skills.length > 5 ? '...' : ''}`);
            }
            if (candidate.repos && candidate.repos > 0) console.log(`   Repos: ${candidate.repos}`);
            if (candidate.followers && candidate.followers > 0) console.log(`   Followers: ${candidate.followers}`);
            if (candidate.hireable !== undefined) console.log(`   Hireable: ${candidate.hireable ? 'Yes' : 'No'}`);

            // Display TL;DR summary
            if (candidate.tldrSummary) {
              console.log(chalk.yellow(`\n   📝 TL;DR:`));
              console.log(chalk.white(`   ${candidate.tldrSummary}`));
            }

            // Display social links
            if (candidate.socialLinks) {
              const links = candidate.socialLinks;
              const hasLinks = Object.values(links).some(v => v);
              if (hasLinks) {
                console.log(chalk.yellow(`\n   📱 Social Links:`));
                if (links.website) console.log(chalk.gray(`      🌐 Website: `) + chalk.blue(links.website));
                if (links.email) console.log(chalk.gray(`      📧 Email: `) + chalk.blue(links.email));
                if (links.twitter) console.log(chalk.gray(`      🐦 Twitter: `) + chalk.blue(links.twitter));
                if (links.linkedin) console.log(chalk.gray(`      💼 LinkedIn: `) + chalk.blue(links.linkedin));
                if (links.github) console.log(chalk.gray(`      🐙 GitHub: `) + chalk.blue(links.github));
                if (links.telegram) console.log(chalk.gray(`      📬 Telegram: `) + chalk.blue(links.telegram));
                if (links.discord) console.log(chalk.gray(`      💬 Discord: `) + chalk.blue(links.discord));
                if (links.stackoverflow) console.log(chalk.gray(`      📚 StackOverflow: `) + chalk.blue(links.stackoverflow));
                if (links.medium) console.log(chalk.gray(`      📰 Medium: `) + chalk.blue(links.medium));
                if (links.dev) console.log(chalk.gray(`      📝 Dev.to: `) + chalk.blue(links.dev));
                if (links.youtube) console.log(chalk.gray(`      📺 YouTube: `) + chalk.blue(links.youtube));
              }
            } else if (candidate.website) {
              // Fallback to website field if socialLinks not available
              console.log(chalk.yellow(`\n   📱 Contact:`));
              console.log(chalk.gray(`      🌐 Website: `) + chalk.blue(candidate.website));
            }

            console.log(chalk.green(`\n   ✓ Match: ${candidate.matchReason}`));
            console.log(chalk.gray('   ' + '─'.repeat(50)));
          });
        } else {
          console.log(chalk.yellow('No candidates found.'));
        }

        console.log(chalk.gray(`\n📝 Summary: ${result.summary}`));
        console.log(chalk.blue('═'.repeat(50)));

      } catch (error) {
        console.error(chalk.red('❌ Error:'), error);
      }
    } catch (error) {
      // Handle Ctrl+C or other readline errors
      if (error instanceof Error && error.message.includes('closed')) {
        await shutdown();
        break;
      }
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
