export function speechError(code, message) {
  return Object.assign(new Error(message), { speechCode: code });
}
