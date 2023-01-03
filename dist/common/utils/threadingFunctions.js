export class Lock {
    constructor() {
        this._locked = false;
        this._waiting = [];
    }
    lock() {
        const unlock = () => {
            let nextResolve;
            if (this._waiting.length > 0) {
                nextResolve = this._waiting.shift();
                nextResolve(unlock);
            }
            else {
                this._locked = false;
            }
        };
        if (this._locked) {
            return new Promise(resolve => {
                this._waiting.push(resolve);
            });
        }
        else {
            this._locked = true;
            return new Promise(resolve => {
                resolve(unlock);
            });
        }
    }
}
// let accountBalance = 0;
// const account = new Lock();
// async function getAccountBalance() {
//   // Suppose this was asynchronously from a database or something
//   return accountBalance;
// }
// async function setAccountBalance(value: number) {
//   // Suppose this was asynchronously from a database or something
//   accountBalance = value;
// }
// async function increment(value: number, incr: number) {
//   return value + incr;
// }
// async function add$50() {
//   const unlock = (await account.lock()) as () => void | Promise<() => void>;
//   const balance = await getAccountBalance();
//   const newBalance = await increment(balance, 50);
//   await setAccountBalance(newBalance);
//   await unlock();
// }
// async function main() {
//   const transaction1 = add$50();
//   const transaction2 = add$50();
//   const transaction3 = add$50();
//   const transaction4 = add$50();
//   await transaction1;
//   await transaction2;
//   await transaction3;
//   await transaction4;
//   console.log("$" + (await getAccountBalance())); // Now will always be $100 regardless
// }
// main();
//# sourceMappingURL=threadingFunctions.js.map