import { MemoryStorage } from '../../src/storage/memory.js';
import { storageContract } from '../support/storage-contract.js';

storageContract('memory', () => Promise.resolve(new MemoryStorage()));
