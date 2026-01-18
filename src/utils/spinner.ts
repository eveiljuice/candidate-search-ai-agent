// Terminal spinner animation for showing agent is thinking
import chalk from 'chalk';

export class ThinkingSpinner {
  private frames: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval: number = 80;
  private currentFrame: number = 0;
  private timerId: NodeJS.Timeout | null = null;
  private text: string = '';
  private stream = process.stderr;
  private isSpinning: boolean = false;

  start(text: string = '🤔 Agent is thinking...'): void {
    if (this.isSpinning) {
      return;
    }

    this.text = text;
    this.isSpinning = true;
    this.currentFrame = 0;

    // Hide cursor
    this.stream.write('\x1B[?25l');

    this.render();
    this.timerId = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.render();
    }, this.interval);
  }

  updateText(text: string): void {
    this.text = text;
    if (this.isSpinning) {
      this.render();
    }
  }

  private render(): void {
    if (!this.isSpinning) {
      return;
    }

    // Clear current line and move cursor to start
    this.stream.write('\r\x1B[K');
    
    // Render spinner frame + text
    const frame = chalk.cyan(this.frames[this.currentFrame]);
    this.stream.write(`${frame} ${chalk.gray(this.text)}`);
  }

  stop(): void {
    if (!this.isSpinning) {
      return;
    }

    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.isSpinning = false;

    // Clear the spinner line
    this.stream.write('\r\x1B[K');

    // Show cursor
    this.stream.write('\x1B[?25h');
  }

  succeed(text?: string): void {
    this.stop();
    if (text) {
      this.stream.write(`${chalk.green('✓')} ${chalk.gray(text)}\n`);
    }
  }

  fail(text?: string): void {
    this.stop();
    if (text) {
      this.stream.write(`${chalk.red('✗')} ${chalk.gray(text)}\n`);
    }
  }

  info(text?: string): void {
    this.stop();
    if (text) {
      this.stream.write(`${chalk.blue('ℹ')} ${chalk.gray(text)}\n`);
    }
  }
}

// Alternative spinner styles
export const SPINNER_STYLES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  dots2: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  line: ['-', '\\', '|', '/'],
  simpleDots: ['.  ', '.. ', '...', ' ..', '  .', '   '],
  bounce: ['⠁', '⠂', '⠄', '⠂'],
  boxBounce: ['▖', '▘', '▝', '▗'],
  thinking: ['🤔   ', '🤔.  ', '🤔.. ', '🤔...'],
  brain: ['🧠   ', '🧠💭  ', '🧠💭💡', '💡  ', '   '],
};

// Multi-stage thinking animation (for longer waits)
export class DetailedThinkingAnimation {
  private spinner: ThinkingSpinner;
  private stage: number = 0;
  private stages = [
    '🤔 Reading page context...',
    '🧠 Analyzing available options...',
    '💭 Considering alternatives...',
    '🎯 Deciding on best approach...',
    '✨ Planning next action...',
  ];
  private stageInterval: number = 2000; // Change stage every 2 seconds
  private stageTimerId: NodeJS.Timeout | null = null;

  constructor() {
    this.spinner = new ThinkingSpinner();
  }

  start(): void {
    this.stage = 0;
    this.spinner.start(this.stages[0]);

    // Cycle through stages
    this.stageTimerId = setInterval(() => {
      this.stage = (this.stage + 1) % this.stages.length;
      this.spinner.updateText(this.stages[this.stage]);
    }, this.stageInterval);
  }

  stop(): void {
    if (this.stageTimerId) {
      clearInterval(this.stageTimerId);
      this.stageTimerId = null;
    }
    this.spinner.stop();
  }

  succeed(text?: string): void {
    this.stop();
    this.spinner.succeed(text);
  }

  fail(text?: string): void {
    this.stop();
    this.spinner.fail(text);
  }
}
