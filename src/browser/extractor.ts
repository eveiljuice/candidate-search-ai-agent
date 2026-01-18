// DOM extraction and compression - converts page to PageContext
import type { Page } from 'playwright';
import type { PageContext, PageElement, Candidate, SocialLinks } from '../types.js';

/**
 * Extracts interactive elements from the page and creates a compressed context
 * This is the key to not sending full HTML to the LLM
 */
export async function extractPageContext(page: Page): Promise<PageContext> {
  const url = page.url();
  const title = await page.title();

  // Extract interactive elements in the browser context
  const elements = await page.evaluate(() => {
    const result: Array<{
      type: string;
      text: string;
      selector: string;
      href?: string;
    }> = [];

    // Helper to get a unique selector - using arrow function to avoid __name issue
    const getSelector: (el: Element) => string = (el) => {
      if (el.id) return `#${el.id}`;
      
      // Try data-testid or other common attributes
      const testId = el.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId}"]`;
      
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return `[aria-label="${ariaLabel}"]`;

      // Build a path-based selector
      const pathParts: string[] = [];
      let current: Element | null = el;
      
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        if (current.className && typeof current.className === 'string') {
          const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.');
          if (classes) selector += `.${classes}`;
        }
        const parentEl: Element | null = current.parentElement;
        if (parentEl) {
          const currentTag = current.tagName;
          const siblings = Array.from(parentEl.children).filter(
            (c: Element) => c.tagName === currentTag
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
        pathParts.unshift(selector);
        current = parentEl;
        if (pathParts.length > 4) break;
      }
      
      return pathParts.join(' > ');
    };

    // Get visible text, truncated - using arrow function to avoid __name issue
    const getText: (el: Element) => string = (el) => {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      return text.slice(0, 100);
    };

    // Check if element is visible - using arrow function to avoid __name issue
    const isVisible: (el: Element) => boolean = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
      );
    };

    // Extract links
    document.querySelectorAll('a[href]').forEach((el) => {
      if (!isVisible(el)) return;
      const href = el.getAttribute('href') || '';
      const text = getText(el) || el.getAttribute('aria-label') || href;
      if (text && href && !href.startsWith('javascript:')) {
        result.push({
          type: 'link',
          text: text.slice(0, 80),
          selector: getSelector(el),
          href,
        });
      }
    });

    // Extract buttons
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el) => {
      if (!isVisible(el)) return;
      const text = getText(el) || el.getAttribute('aria-label') || el.getAttribute('value') || 'Button';
      result.push({
        type: 'button',
        text: text.slice(0, 80),
        selector: getSelector(el),
      });
    });

    // Extract inputs
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea').forEach((el) => {
      if (!isVisible(el)) return;
      const input = el as HTMLInputElement;
      const text = input.placeholder || input.getAttribute('aria-label') || input.name || input.type || 'Input';
      result.push({
        type: el.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'input',
        text: text.slice(0, 80),
        selector: getSelector(el),
      });
    });

    // Extract selects
    document.querySelectorAll('select').forEach((el) => {
      if (!isVisible(el)) return;
      const text = el.getAttribute('aria-label') || el.name || 'Select';
      result.push({
        type: 'select',
        text: text.slice(0, 80),
        selector: getSelector(el),
      });
    });

    return result;
  });

  // Generate ref IDs and deduplicate
  const seen = new Set<string>();
  const counters: Record<string, number> = { link: 0, button: 0, input: 0, textarea: 0, select: 0 };
  
  const pageElements: PageElement[] = elements
    .filter((el) => {
      const key = `${el.type}:${el.text}:${el.href || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 150) // Limit to 150 elements
    .map((el) => {
      const typeKey = el.type as keyof typeof counters;
      counters[typeKey] = (counters[typeKey] || 0) + 1;
      const prefix = el.type === 'link' ? 'link' : el.type === 'button' ? 'btn' : el.type;
      return {
        ref: `${prefix}_${counters[typeKey]}`,
        type: el.type as PageElement['type'],
        text: el.text,
        selector: el.selector,
        href: el.href,
      };
    });

  return {
    url,
    title,
    elements: pageElements,
  };
}

/**
 * Generic data extraction from current page using semantic analysis
 * Agent must guide this by navigating to correct pages - no assumptions about site structure
 */
export async function extractCandidates(page: Page): Promise<Candidate[]> {
  return await page.evaluate(() => {
    const candidates: Candidate[] = [];
    
    // Helper: Extract text with fallback
    const extractText = (el: Element | null, maxLength = 200): string | undefined => {
      if (!el) return undefined;
      const text = el.textContent?.trim();
      return text ? text.slice(0, maxLength) : undefined;
    };
    
    // Helper: Parse number from text (handles 1.2k format)
    const parseNumber = (text: string | undefined): number | undefined => {
      if (!text) return undefined;
      const normalized = text.toLowerCase().replace(/,/g, '');
      const match = normalized.match(/([\d.]+)([km]?)/);
      if (!match) return undefined;
      
      let num = parseFloat(match[1]);
      const suffix = match[2];
      if (suffix === 'k') num *= 1000;
      if (suffix === 'm') num *= 1000000;
      return Math.floor(num);
    };
    
    // Strategy 1: Look for semantic schema.org markup (universal across platforms)
    const schemaElements = document.querySelectorAll('[itemtype*="Person"], [itemtype*="ProfilePage"]');
    schemaElements.forEach((el) => {
      const profileUrl = window.location.href;
      const username = el.querySelector('[itemprop="alternateName"], [itemprop="identifier"]')?.textContent?.trim() 
        || profileUrl.split('/').filter(Boolean).pop();
      
      if (!username) return;
      
      candidates.push({
        username,
        profileUrl,
        name: extractText(el.querySelector('[itemprop="name"]')),
        bio: extractText(el.querySelector('[itemprop="description"]')),
        location: extractText(el.querySelector('[itemprop="homeLocation"], [itemprop="address"]')),
        topLanguages: [],
        repos: undefined,
        followers: undefined,
        matchReason: 'Extracted using semantic markup',
      });
    });
    
    // Strategy 2: Generic structural patterns (headings + lists)
    // Look for profile-like structures: name in heading + bio + stats
    const mainContent = document.querySelector('main, [role="main"], .main-content, #content') || document.body;
    
    // Find heading that might be a name
    const nameHeading = mainContent.querySelector('h1, h2, [class*="name"], [class*="title"]');
    if (nameHeading && candidates.length === 0) {
      const profileUrl = window.location.href;
      const username = profileUrl.split('/').filter(Boolean).pop() || extractText(nameHeading) || 'unknown';
      
      // Look for bio nearby (usually p tags or divs with class containing "bio", "about", "description")
      const bioElement = mainContent.querySelector('[class*="bio"], [class*="about"], [class*="description"], [class*="summary"]');
      
      // Look for location (icons often use location-related classes)
      const locationElement = mainContent.querySelector('[class*="location"], [aria-label*="location" i], [title*="location" i]');
      
      // Extract any numeric stats (repos, followers, etc.)
      const statElements = mainContent.querySelectorAll('[class*="stat"], [class*="count"], [class*="number"]');
      let repos: number | undefined;
      let followers: number | undefined;
      
      statElements.forEach((el) => {
        const text = el.textContent?.toLowerCase() || '';
        const value = parseNumber(el.textContent || '');
        
        if (text.includes('repo') && !repos) repos = value;
        if ((text.includes('follower') || text.includes('subscriber')) && !followers) followers = value;
      });
      
      candidates.push({
        username,
        profileUrl,
        name: extractText(nameHeading),
        bio: extractText(bioElement),
        location: extractText(locationElement),
        topLanguages: [],
        repos,
        followers,
        matchReason: 'Extracted using structural analysis',
      });
    }
    
    // Strategy 3: List of profiles (search results, directories)
    // Look for repeated structures containing links to profiles
    const listItems = mainContent.querySelectorAll('li, [class*="item"], [class*="card"], [class*="result"]');
    const profileLinks: Array<{ href: string; element: Element }> = [];
    
    listItems.forEach((item) => {
      // Find links that look like profile links (not just any link)
      const links = item.querySelectorAll('a[href*="/"], a[href^="http"]');
      links.forEach((link) => {
        const href = link.getAttribute('href');
        if (href && !href.includes('#') && !href.includes('?') && href.split('/').length >= 2) {
          profileLinks.push({ href, element: item });
        }
      });
    });
    
    // If we found multiple similar items, extract from each
    if (profileLinks.length > 2 && candidates.length === 0) {
      profileLinks.slice(0, 50).forEach(({ href, element }) => {
        const username = href.replace(/^https?:\/\/[^\/]+\//, '').split('/')[0];
        if (!username || username.length < 2) return;
        
        const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
        
        candidates.push({
          username,
          profileUrl: fullUrl,
          name: extractText(element.querySelector('[class*="name"], [class*="title"], strong, b')),
          bio: extractText(element.querySelector('[class*="bio"], [class*="description"], [class*="summary"], p')),
          location: extractText(element.querySelector('[class*="location"]')),
          topLanguages: [],
          repos: undefined,
          followers: undefined,
          matchReason: 'Found in listing/search results',
        });
      });
    }
    
    return candidates;
  });
}

/**
 * Get a text summary of the page (for context)
 */
export async function getPageTextSummary(page: Page): Promise<string> {
  return await page.evaluate(() => {
    // Get main content area
    const main = document.querySelector('main, [role="main"], .repository-content, .application-main') || document.body;
    const text = main.textContent || '';
    // Clean and truncate
    return text.replace(/\s+/g, ' ').trim().slice(0, 1500);
  });
}

/**
 * Extract social links from a profile page
 * Works across multiple platforms (GitHub, LinkedIn, Twitter, etc.)
 */
export async function extractSocialLinks(page: Page): Promise<SocialLinks> {
  return await page.evaluate(() => {
    const links: SocialLinks = {};
    const otherLinks: string[] = [];
    
    // Social media patterns to detect
    const patterns: Record<string, RegExp> = {
      github: /github\.com\/[\w-]+/i,
      twitter: /(?:twitter\.com|x\.com)\/[\w-]+/i,
      linkedin: /linkedin\.com\/in\/[\w-]+/i,
      telegram: /t\.me\/[\w-]+/i,
      discord: /discord\.(?:gg|com)\/[\w-]+/i,
      stackoverflow: /stackoverflow\.com\/users\/\d+/i,
      medium: /medium\.com\/@?[\w-]+/i,
      dev: /dev\.to\/[\w-]+/i,
      youtube: /(?:youtube\.com\/(?:c\/|channel\/|@)?[\w-]+|youtu\.be\/[\w-]+)/i,
    };
    
    // Email pattern
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    
    // Find all links on the page
    const allLinks = document.querySelectorAll('a[href]');
    
    allLinks.forEach((el) => {
      const href = el.getAttribute('href') || '';
      const text = el.textContent?.trim() || '';
      const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
      
      // Skip internal navigation links
      if (href.startsWith('#') || href === '/') return;
      
      // Check for each social pattern
      for (const [platform, pattern] of Object.entries(patterns)) {
        if (pattern.test(href)) {
          const fullUrl = href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`;
          (links as any)[platform] = fullUrl;
          return;
        }
      }
      
      // Check for personal website (rel="me" or links with "website", "blog", "portfolio" text)
      const isWebsiteLink = 
        el.getAttribute('rel')?.includes('me') ||
        ariaLabel.includes('website') ||
        ariaLabel.includes('blog') ||
        ariaLabel.includes('portfolio') ||
        text.toLowerCase().includes('website') ||
        text.toLowerCase().includes('blog') ||
        text.toLowerCase().includes('portfolio') ||
        el.closest('[itemprop="url"]') !== null;
      
      if (isWebsiteLink && href.startsWith('http') && !href.includes('github.com')) {
        if (!links.website) {
          links.website = href;
        }
      }
      
      // Check for email in mailto: links
      if (href.startsWith('mailto:')) {
        const email = href.replace('mailto:', '').split('?')[0];
        if (emailPattern.test(email)) {
          links.email = email;
        }
      }
    });
    
    // Also check for email in text content (if not found via mailto)
    if (!links.email) {
      const bodyText = document.body.textContent || '';
      const emailMatch = bodyText.match(emailPattern);
      if (emailMatch && !emailMatch[0].includes('example.com') && !emailMatch[0].includes('users.noreply')) {
        links.email = emailMatch[0];
      }
    }
    
    // Look for social links in specific areas (sidebar, vcard, profile sections)
    const socialContainers = document.querySelectorAll(
      '.vcard-details, .profile-links, [class*="social"], [class*="contact"], ' +
      '[aria-label*="social"], [data-testid*="social"], .user-profile-bio, ' +
      '[class*="profile-header"], [class*="user-info"]'
    );
    
    socialContainers.forEach((container) => {
      container.querySelectorAll('a[href]').forEach((el) => {
        const href = el.getAttribute('href') || '';
        
        for (const [platform, pattern] of Object.entries(patterns)) {
          if (pattern.test(href) && !(links as any)[platform]) {
            const fullUrl = href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`;
            (links as any)[platform] = fullUrl;
          }
        }
        
        // Website detection in social containers
        if (!links.website && href.startsWith('http') && 
            !Object.values(patterns).some(p => p.test(href))) {
          links.website = href;
        }
      });
    });
    
    if (otherLinks.length > 0) {
      links.other = [...new Set(otherLinks)];
    }
    
    return links;
  });
}

/**
 * Extract all available tabs/sections on a profile page
 * Returns list of clickable tab elements
 */
export async function extractProfileTabs(page: Page): Promise<Array<{ name: string; ref: string; href?: string }>> {
  return await page.evaluate(() => {
    const tabs: Array<{ name: string; ref: string; href?: string }> = [];
    
    // Common tab patterns across platforms
    const tabSelectors = [
      'nav[aria-label*="User"] a, nav[aria-label*="user"] a',
      '[role="tablist"] [role="tab"], [role="tablist"] a',
      '.UnderlineNav-item, .js-selected-navigation-item',
      '[class*="profile-tab"], [class*="ProfileTab"]',
      '[data-tab-item], [data-testid*="tab"]',
      '.tabnav-tab, .subnav-item',
    ];
    
    let tabIndex = 0;
    
    tabSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        const text = el.textContent?.trim() || '';
        const href = el.getAttribute('href') || undefined;
        
        if (text && text.length < 50) {
          tabs.push({
            name: text,
            ref: `tab_${tabIndex++}`,
            href,
          });
        }
      });
    });
    
    // Deduplicate by name
    const seen = new Set<string>();
    return tabs.filter((t) => {
      const key = t.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

/**
 * Extract detailed profile info for deep scanning
 */
export async function extractDetailedProfileInfo(page: Page): Promise<{
  pinnedRepos: string[];
  organizations: string[];
  contributions: string;
  achievements: string[];
  skills: string[];
  experience: string[];
  readmeContent?: string;
}> {
  return await page.evaluate(() => {
    const result = {
      pinnedRepos: [] as string[],
      organizations: [] as string[],
      contributions: '',
      achievements: [] as string[],
      skills: [] as string[],
      experience: [] as string[],
      readmeContent: undefined as string | undefined,
    };
    
    // Pinned repos (GitHub style)
    document.querySelectorAll('.pinned-item-list-item, [class*="pinned"] [class*="repo"]').forEach((el) => {
      const name = el.querySelector('span.repo, [itemprop="name"], .text-bold')?.textContent?.trim();
      const desc = el.querySelector('p.pinned-item-desc, [class*="description"]')?.textContent?.trim();
      if (name) {
        result.pinnedRepos.push(desc ? `${name}: ${desc}` : name);
      }
    });
    
    // Organizations
    document.querySelectorAll('[aria-label="Organizations"] a, .avatar-group-item, [class*="org-"] a').forEach((el) => {
      const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim();
      if (name && !result.organizations.includes(name)) {
        result.organizations.push(name);
      }
    });
    
    // Contributions (GitHub activity graph summary)
    const contributionsEl = document.querySelector('.js-yearly-contributions h2, [class*="contribution"] h2, [class*="ContributionCalendar"] h2');
    if (contributionsEl) {
      result.contributions = contributionsEl.textContent?.trim() || '';
    }
    
    // Achievements/badges
    document.querySelectorAll('.achievement-badge, [class*="badge"], [class*="achievement"]').forEach((el) => {
      const text = el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent?.trim();
      if (text && text.length < 100) {
        result.achievements.push(text);
      }
    });
    
    // Skills (from skill tags, keywords, tech stack sections)
    document.querySelectorAll(
      '[class*="skill"], [class*="tag"], [class*="tech"], ' +
      '[data-testid*="skill"], .topic-tag, .IssueLabel'
    ).forEach((el) => {
      const text = el.textContent?.trim();
      if (text && text.length < 30 && !result.skills.includes(text)) {
        result.skills.push(text);
      }
    });
    
    // Experience (from timeline, work sections)
    document.querySelectorAll(
      '[class*="experience"], [class*="work"], [class*="timeline-item"], ' +
      '[class*="position"], [class*="job"]'
    ).forEach((el) => {
      const text = el.textContent?.trim();
      if (text && text.length > 10 && text.length < 200) {
        result.experience.push(text);
      }
    });
    
    // Profile README content
    const readmeEl = document.querySelector(
      '.markdown-body.user-profile-bio, article[class*="readme"], ' +
      '[data-testid="profile-readme"], .profile-readme'
    );
    if (readmeEl) {
      result.readmeContent = readmeEl.textContent?.trim().slice(0, 1000);
    }
    
    return result;
  });
}
