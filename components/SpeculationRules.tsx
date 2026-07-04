const rules = {
  prerender: [
    {
      source: 'document',
      where: {
        and: [
          { href_matches: '/*' },
          { not: { href_matches: '/feed.xml' } },
          { not: { href_matches: '/robots.txt' } },
          { not: { href_matches: '/sitemap.xml' } },
          { not: { href_matches: '/static/*' } },
          { not: { href_matches: '/_next/*' } },
        ],
      },
      eagerness: 'conservative',
    },
  ],
}

export default function SpeculationRules() {
  return (
    <script type="speculationrules" dangerouslySetInnerHTML={{ __html: JSON.stringify(rules) }} />
  )
}
