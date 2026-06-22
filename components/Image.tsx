import NextImage, { ImageProps } from 'next/image'

// Keep image imports behind one component so static export fallbacks can be added centrally.
const Image = (props: ImageProps) => <NextImage {...props} />

export default Image
