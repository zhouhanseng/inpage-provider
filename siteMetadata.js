
const Through = require('through2')

module.exports = {
  getSiteMetadata,
  createObjectTransformStream,
}

/**
 * Returns a transform stream that applies some transform function to objects
 * passing through.
 * @param {function} transformFunction the function transforming the object
 * @return {stream.Transform}
 */
function createObjectTransformStream (transformFunction) {
  return Through.obj(function (obj, _, cb) {
    this.push(transformFunction(obj))
    cb()
  })
}

/**
 * Gets site metadata and returns it
 *
 */
function getSiteMetadata () {
  // get metadata
  const metadata = {
    name: getSiteName(window),
    icon: getSiteIcon(window),
  }
  return metadata
}

/**
 * Extracts a name for the site from the DOM
 */
function getSiteName (window) {
  const document = window.document
  const siteName = document.querySelector('head > meta[property="og:site_name"]')
  if (siteName) {
    return siteName.content
  }

  const metaTitle = document.querySelector('head > meta[name="title"]')
  if (metaTitle) {
    return metaTitle.content
  }

  return document.title
}

/**
 * Extracts an icon for the site from the DOM
 */
function getSiteIcon (window) {
  const document = window.document

  // Use the site's favicon if it exists
  const shortcutIcon = document.querySelector('head > link[rel="shortcut icon"]')
  if (shortcutIcon) {
    return shortcutIcon.href
  }

  // Search through available icons in no particular order
  const icon = Array.from(document.querySelectorAll('head > link[rel="icon"]')).find((icon) => Boolean(icon.href))
  if (icon) {
    return icon.href
  }

  return null
}