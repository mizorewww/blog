package main

// writeAbout writes the edition's /about/ profile page.
func (b *builder) writeAbout(e *edition) error {
	about := e.lang.Base + "/about/"
	ui := e.lang.UI
	if err := b.page(about, Page{Lang: e.lang, Title: ui.About + " — " + ui.Title, Description: ui.AboutDesc, Kind: "about", Switch: b.switchTo(e, "/about/")}, ""); err != nil {
		return err
	}
	b.sitemap.URLs = append(b.sitemap.URLs, Location{b.site.URL + about, newestOf(e.posts)})
	return nil
}
