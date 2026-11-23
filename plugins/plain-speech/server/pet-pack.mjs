import decodePetPack from '../ui/pet-format.js';

export function normalizePetPack(pack) {
  return decodePetPack(pack)?.pack;
}
