// Lets any module fire a toast without importing React. Split out of
// Toast.jsx so that file exports only the ToastContainer component (mixing
// component and non-component exports in one file breaks Vite fast refresh).
let _addToast = null

export function toast(message, type = 'error') {
  _addToast?.({ message, type, id: Date.now() + Math.random() })
}

export function registerToastHandler(fn) {
  _addToast = fn
}
