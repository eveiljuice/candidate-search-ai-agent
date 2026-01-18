// Playwright browser controller with persistent sessions
import { chromium, type BrowserContext, type Page } from 'playwright';
import { 
  extractPageContext, 
  extractCandidates, 
  extractSocialLinks, 
  extractProfileTabs, 
  extractDetailedProfileInfo,
  getPageTextSummary 
} from './extractor.js';
import type { PageContext, Candidate, ToolResult, SocialLinks } from '../types.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = path.join(__dirname, '../../.browser-data');

export class BrowserController {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private elementMap: Map<string, string> = new Map(); // ref -> selector
  private retryCount: Map<string, number> = new Map(); // action -> retry count

  async initialize(): Promise<void> {
    // Ensure user data directory exists for persistent sessions
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    // Use persistent context for session storage (this launches browser automatically)
    this.context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      devtools: false, // Set to true if keyboard still blocked
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      slowMo: 100, // Increase delay for more reliable input
      // Ignore automation flags that can block keyboard
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
      acceptDownloads: true,
      bypassCSP: true,
    });

    // Fix for tsx/esbuild __name is not defined error in page.evaluate()
    // Define __name globally before any page scripts run
    await this.context.addInitScript(() => {
      (window as any).__name = (fn: any, name: string) => fn;
    });

    // Get or create page
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Set default timeout
    this.page.setDefaultTimeout(15000);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
    }
  }

  private getPage(): Page {
    if (!this.page) throw new Error('Browser not initialized');
    return this.page;
  }

  private getRetryKey(action: string, ...args: string[]): string {
    return `${action}:${args.join(':')}`;
  }

  private checkRetryLimit(key: string): boolean {
    const count = this.retryCount.get(key) || 0;
    if (count >= 3) {
      this.retryCount.delete(key);
      return false;
    }
    this.retryCount.set(key, count + 1);
    return true;
  }

  private clearRetry(key: string): void {
    this.retryCount.delete(key);
  }

  // === Tool implementations ===

  async navigate(url: string): Promise<ToolResult> {
    const page = this.getPage();
    const retryKey = this.getRetryKey('navigate', url);

    try {
      // Ensure URL has protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1000); // Let page settle
      
      this.clearRetry(retryKey);
      return {
        success: true,
        data: { url: page.url(), title: await page.title() },
      };
    } catch (error) {
      if (this.checkRetryLimit(retryKey)) {
        return { success: false, error: `Navigation failed: ${error}. Retrying...` };
      }
      return { success: false, error: `Navigation failed after retries: ${error}` };
    }
  }

  async click(ref: string): Promise<ToolResult> {
    const page = this.getPage();
    const selector = this.elementMap.get(ref);
    const retryKey = this.getRetryKey('click', ref);

    if (!selector) {
      return { success: false, error: `Element "${ref}" not found. Call get_page_context() first to refresh elements.` };
    }

    try {
      // Try to find and click the element
      const element = page.locator(selector).first();
      
      // Scroll into view if needed
      await element.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(200);
      
      // Click
      await element.click({ timeout: 5000 });
      await page.waitForTimeout(500); // Wait for any navigation/updates
      
      this.clearRetry(retryKey);
      return { success: true, data: { clicked: ref } };
    } catch (error) {
      if (this.checkRetryLimit(retryKey)) {
        // Try alternative: force click or scroll more
        try {
          await page.locator(selector).first().click({ force: true, timeout: 3000 });
          this.clearRetry(retryKey);
          return { success: true, data: { clicked: ref, forced: true } };
        } catch {
          return { success: false, error: `Click failed: ${error}. Try scrolling or refreshing page context.` };
        }
      }
      return { success: false, error: `Click failed after retries: ${error}` };
    }
  }

  async typeText(ref: string, text: string, pressEnter: boolean = false): Promise<ToolResult> {
    const page = this.getPage();
    const selector = this.elementMap.get(ref);
    const retryKey = this.getRetryKey('type', ref);

    if (!selector) {
      return { success: false, error: `Element "${ref}" not found. Call get_page_context() first.` };
    }

    try {
      const element = page.locator(selector).first();
      
      // Scroll into view and ensure element is visible
      await element.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(300);
      
      // Click to focus
      await element.click({ timeout: 5000, force: false });
      await page.waitForTimeout(500);
      
      // Triple-click to select all existing text
      await element.click({ clickCount: 3 });
      await page.waitForTimeout(200);
      
      // Delete selected text
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
      
      // Type text using page.keyboard (most reliable method)
      await page.keyboard.type(text, { delay: 80 });
      await page.waitForTimeout(300);
      
      if (pressEnter) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000); // Wait for search/navigation
      }
      
      this.clearRetry(retryKey);
      return { success: true, data: { typed: text, pressedEnter: pressEnter } };
    } catch (error) {
      if (this.checkRetryLimit(retryKey)) {
        // Fallback 1: try fill() method
        try {
          const element = page.locator(selector).first();
          await element.scrollIntoViewIfNeeded();
          await element.fill(text);
          await page.waitForTimeout(300);
          if (pressEnter) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1500);
          }
          this.clearRetry(retryKey);
          return { success: true, data: { typed: text, pressedEnter: pressEnter, method: 'fill' } };
        } catch (fillError) {
          // Fallback 2: try pressSequentially
          try {
            const element = page.locator(selector).first();
            await element.click();
            await page.waitForTimeout(200);
            await element.pressSequentially(text, { delay: 100 });
            if (pressEnter) {
              await page.keyboard.press('Enter');
              await page.waitForTimeout(1500);
            }
            this.clearRetry(retryKey);
            return { success: true, data: { typed: text, pressedEnter: pressEnter, method: 'pressSequentially' } };
          } catch {
            return { success: false, error: `All type methods failed. Last error: ${error}` };
          }
        }
      }
      return { success: false, error: `Type failed after retries: ${error}` };
    }
  }

  async scroll(direction: 'up' | 'down'): Promise<ToolResult> {
    const page = this.getPage();
    
    try {
      const delta = direction === 'down' ? 500 : -500;
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(500);
      
      return { success: true, data: { scrolled: direction } };
    } catch (error) {
      return { success: false, error: `Scroll failed: ${error}` };
    }
  }

  async getPageContext(): Promise<ToolResult> {
    const page = this.getPage();
    
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      const context = await extractPageContext(page);
      
      // Update element map
      this.elementMap.clear();
      for (const el of context.elements) {
        this.elementMap.set(el.ref, el.selector);
      }
      
      return { success: true, data: context };
    } catch (error) {
      return { success: false, error: `Failed to extract page context: ${error}` };
    }
  }

  async extractCandidates(): Promise<ToolResult> {
    const page = this.getPage();
    
    try {
      const candidates = await extractCandidates(page);
      return { success: true, data: { candidates } };
    } catch (error) {
      return { success: false, error: `Failed to extract candidates: ${error}` };
    }
  }

  // Helper method to check if logged into GitHub
  async isGitHubLoggedIn(): Promise<boolean> {
    const page = this.getPage();
    try {
      await page.goto('https://github.com', { waitUntil: 'domcontentloaded' });
      const avatar = await page.$('img.avatar-user, [data-login]');
      return avatar !== null;
    } catch {
      return false;
    }
  }

  // === New methods for sub-agent profile scanning ===

  /**
   * Extract social links from current page
   */
  async extractSocialLinks(): Promise<ToolResult> {
    const page = this.getPage();
    
    try {
      const socialLinks = await extractSocialLinks(page);
      return { success: true, data: socialLinks };
    } catch (error) {
      return { success: false, error: `Failed to extract social links: ${error}` };
    }
  }

  /**
   * Extract available tabs/sections on a profile page
   */
  async extractProfileTabs(): Promise<ToolResult> {
    const page = this.getPage();
    
    try {
      const tabs = await extractProfileTabs(page);
      return { success: true, data: tabs };
    } catch (error) {
      return { success: false, error: `Failed to extract profile tabs: ${error}` };
    }
  }

  /**
   * Extract detailed profile info (pinned repos, orgs, etc.)
   */
  async extractDetailedProfileInfo(): Promise<ToolResult> {
    const page = this.getPage();
    
    try {
      const info = await extractDetailedProfileInfo(page);
      return { success: true, data: info };
    } catch (error) {
      return { success: false, error: `Failed to extract detailed profile info: ${error}` };
    }
  }

  /**
   * Get text summary of the current page
   */
  async getPageTextSummary(): Promise<ToolResult> {
    const page = this.getPage();
    
    try {
      const summary = await getPageTextSummary(page);
      return { success: true, data: summary };
    } catch (error) {
      return { success: false, error: `Failed to get page text summary: ${error}` };
    }
  }
}
