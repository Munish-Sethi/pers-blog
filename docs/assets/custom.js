// Make the site name in the header a link to the homepage
// This works for Material for MkDocs

document.addEventListener("DOMContentLoaded", function() {
  var siteName = document.querySelector('.md-header__title .md-header__topic');
  if (siteName) {
    var link = document.createElement('a');
    link.href = (window.location.pathname.startsWith('/pers-blog/') ? '/pers-blog/' : '/');
    link.style.color = 'inherit';
    link.style.textDecoration = 'none';
    link.innerHTML = siteName.innerHTML;
    siteName.innerHTML = '';
    siteName.appendChild(link);
  }
});
