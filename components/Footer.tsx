import siteMetadata from '@/data/siteMetadata'
import SocialIcon from '@/components/social-icons'

export default function Footer() {
  return (
    <footer className="shrink-0 bg-transparent text-slate-500 dark:text-white/45">
      <div className="blog-shell mx-auto flex w-full flex-col items-center border-t border-slate-200 px-4 py-7 text-center dark:border-[#2f3947]">
        <div className="mb-3 flex space-x-4 text-slate-500 dark:text-white/55">
          <SocialIcon kind="mail" href={`mailto:${siteMetadata.email}`} size={6} />
          <SocialIcon kind="github" href={siteMetadata.github} size={6} />
          <SocialIcon kind="x" href={siteMetadata.x} size={6} />
          <SocialIcon kind="telegram" href={siteMetadata.telegram} size={6} />
        </div>
        <div className="mb-2 flex flex-wrap justify-center gap-x-2 text-sm">
          <div>{siteMetadata.author}</div>
          <div>{` • `}</div>
          <div>{`© ${new Date().getFullYear()}`}</div>
          <div>{` • `}</div>
          <div>{siteMetadata.title}</div>
        </div>
      </div>
    </footer>
  )
}
