
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
async function getSiteMetadata () {
  // get metadata
  const metadata = {
    name: getSiteName(window),
    icon: await getSiteIcon(window),
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

  if (document.title && document.title.length > 0) return document.title

  return window.location.hostname
}

/**
 * Extracts an icon for the site from the DOM
 */
async function getSiteIcon (window) {
  const document = window.document

  // Use the site's favicon if it exists
  let icon = document.querySelector('head > link[rel="shortcut icon"]')
  if (icon) {
    if (await resourceExists(icon.href)) return icon.href
  }

  // Search through available icons in no particular order
  icon = Array.from(document.querySelectorAll('head > link[rel="icon"]'))
  .find((icon) => Boolean(icon.href))
  if (icon) {
    if (await resourceExists(icon.href)) return icon.href
  }

  return null
}

/**
 * Returns whether the given resource exists
 * @param {string} url the url of the resource
 */
function resourceExists (url) {
  return fetch(url)
  .then(res => res.ok)
  .catch(() => false)
}
