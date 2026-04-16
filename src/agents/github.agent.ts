import { Octokit } from '@octokit/rest'
import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'

const log = childLogger('agent:github')

export async function collectGithubInfo(): Promise<KnowledgeInput[]> {
  log.info('Collecting GitHub information')
  const items: KnowledgeInput[] = []

  if (!cfg.githubToken || !cfg.githubUsername) {
    log.warn('GITHUB_TOKEN or GITHUB_USERNAME not set, skipping GitHub collection')
    return items
  }

  const octokit = new Octokit({ auth: cfg.githubToken })

  try {
    // User profile
    const { data: user } = await octokit.rest.users.getAuthenticated()
    items.push({
      title: `GitHub Profile: ${user.login}`,
      content: `GitHub user: ${user.name ?? user.login}, Bio: ${user.bio ?? 'n/a'}, Followers: ${user.followers}, Following: ${user.following}, Public repos: ${user.public_repos}, Company: ${user.company ?? 'n/a'}, Location: ${user.location ?? 'n/a'}`,
      category: 'github',
      source: 'github-agent',
      metadata: { login: user.login, id: user.id },
      importance_score: 0.9,
    })

    // Repositories
    const repos: Array<{
      name: string; full_name: string; description: string | null;
      language: string | null; stargazers_count: number; forks_count: number;
      open_issues_count: number; updated_at: string | null;
      visibility: string; topics: string[]; private: boolean;
    }> = []

    let page = 1
    while (true) {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 100, page, sort: 'updated', direction: 'desc',
      })
      repos.push(...data.map(r => ({ ...r, visibility: r.visibility ?? 'unknown', topics: r.topics ?? [] })))
      if (data.length < 100) break
      page++
    }

    // Summary
    const byLang: Record<string, number> = {}
    repos.forEach(r => { if (r.language) byLang[r.language] = (byLang[r.language] ?? 0) + 1 })
    const topLangs = Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 10)

    items.push({
      title: `GitHub Repos Summary (${repos.length} repos)`,
      content: `Total repos: ${repos.length}. Top languages: ${topLangs.map(([l, c]) => `${l}(${c})`).join(', ')}. Public: ${repos.filter(r => !r.private).length}, Private: ${repos.filter(r => r.private).length}`,
      category: 'github',
      source: 'github-agent',
      metadata: { total: repos.length, languages: byLang },
      importance_score: 0.9,
    })

    // Individual repo details
    for (const repo of repos.slice(0, 50)) {
      items.push({
        title: `Repo: ${repo.full_name}`,
        content: `${repo.description ?? 'No description'}. Language: ${repo.language ?? 'n/a'}, Stars: ${repo.stargazers_count}, Forks: ${repo.forks_count}, Issues: ${repo.open_issues_count}, Updated: ${repo.updated_at}, Visibility: ${repo.visibility}, Topics: ${repo.topics?.join(', ') ?? 'none'}`,
        category: 'github',
        source: 'github-agent',
        metadata: {
          name: repo.name, language: repo.language, stars: repo.stargazers_count,
          forks: repo.forks_count, updated_at: repo.updated_at, private: repo.private,
        },
        importance_score: Math.min(0.9, 0.5 + (repo.stargazers_count / 100)),
      })
    }

    // Recent events (activity)
    try {
      const { data: events } = await octokit.rest.activity.listPublicEventsForUser({
        username: cfg.githubUsername, per_page: 30,
      })
      const evSummary = events.slice(0, 10).map(e => `${e.type} on ${(e as unknown as { repo?: { name: string } }).repo?.name ?? 'unknown'} at ${e.created_at}`).join('\n')
      items.push({
        title: `GitHub Recent Activity (${events.length} events)`,
        content: `Recent GitHub events:\n${evSummary}`,
        category: 'github',
        source: 'github-agent',
        metadata: { count: events.length },
        importance_score: 0.6,
      })
    } catch { /* activity is optional */ }

  } catch (err) {
    log.error({ err }, 'GitHub collection failed')
  }

  log.info({ count: items.length }, 'GitHub info collected')
  return items
}
