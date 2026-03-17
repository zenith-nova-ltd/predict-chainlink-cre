import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  // const RPC_URL = process.env.RPC_URL || 'https://polygon-rpc.com';
  // const PRIVATE_KEY = process.env.PRIVATE_KEY as string;
  // const CTF_ADDRESS = process.env.CTF_ADDRESS as string;
  // const OPERATOR = process.env.OPERATOR_ADDRESS as string;

  // if (!PRIVATE_KEY || !CTF_ADDRESS || !OPERATOR) {
  //   throw new Error('Missing PRIVATE_KEY / CTF_ADDRESS / OPERATOR_ADDRESS in environment variables');
  // }

  // const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  // const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // const erc1155Abi = [
  //   'function setApprovalForAll(address operator, bool approved) external',
  //   'function isApprovedForAll(address account, address operator) view returns (bool)',
  // ];

  // const ctf = new ethers.Contract(CTF_ADDRESS, erc1155Abi, wallet);

  // console.log('Owner:', wallet.address);
  // console.log('CTF contract:', CTF_ADDRESS);
  // console.log('Operator (exchange):', OPERATOR);

  // const before: boolean = await ctf.isApprovedForAll(wallet.address, OPERATOR);
  // console.log('isApprovedForAll before:', before);

  // if (before) {
  //   console.log('Already approved, nothing to do.');
  //   return;
  // }

  // // LẤY FEE DATA VÀ TĂNG LÊN CHO ĐỦ
  // const feeData = await provider.getFeeData();
  // // Đặt tối thiểu 30 gwei cho priority & maxFee
  // const minTip = ethers.utils.parseUnits('30', 'gwei');
  // const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas.gt(minTip)
  //   ? feeData.maxPriorityFeePerGas
  //   : minTip;
  // const minMaxFee = ethers.utils.parseUnits('40', 'gwei');
  // const maxFeePerGas = feeData.maxFeePerGas && feeData.maxFeePerGas.gt(minMaxFee)
  //   ? feeData.maxFeePerGas
  //   : minMaxFee;

  // console.log('Using maxPriorityFeePerGas:', ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei'), 'gwei');
  // console.log('Using maxFeePerGas:', ethers.utils.formatUnits(maxFeePerGas, 'gwei'), 'gwei');

  // const tx = await ctf.setApprovalForAll(OPERATOR, true, {
  //   maxPriorityFeePerGas,
  //   maxFeePerGas,
  // });

  // console.log('Tx sent:', tx.hash);
  // const receipt = await tx.wait();
  // console.log('Tx confirmed in block', receipt.blockNumber);

  // const after: boolean = await ctf.isApprovedForAll(wallet.address, OPERATOR);
  // console.log('isApprovedForAll after:', after);

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL;
  
  const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  const CTF    = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
  
  const TARGETS = [
    { name: "CTF Exchange",         address: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" },
    { name: "Neg Risk CTF Exchange",address: "0xC5d563A36AE78145C45a50134d48A1215220f80a" },
    { name: "Neg Risk Adapter",     address: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" },
  ];
  
  const ERC20_ABI   = ["function approve(address spender, uint256 amount) returns (bool)"];
  const ERC1155_ABI = ["function setApprovalForAll(address operator, bool approved)"];
  
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  const usdc     = new ethers.Contract(USDC_E, ERC20_ABI, wallet);
  const ctf      = new ethers.Contract(CTF,    ERC1155_ABI, wallet);
  
  const MAX = ethers.constants.MaxUint256;
  // ✅ Fix gas cho Polygon - ethers v5 dùng BigNumber
const GAS_OVERRIDES = {
  maxPriorityFeePerGas: ethers.utils.parseUnits("30", "gwei"), // >= 25 gwei
};
  
  for (const target of TARGETS) {
    console.log(`\n🔑 Setting approvals for ${target.name}...`);
  
    const tx1 = await usdc.approve(target.address, MAX, GAS_OVERRIDES);
    await tx1.wait();
    console.log(`  ✅ USDC.e approved: ${tx1.hash}`);
  
    const tx2 = await ctf.setApprovalForAll(target.address, true, GAS_OVERRIDES);
    await tx2.wait();
    console.log(`  ✅ CTF approved:    ${tx2.hash}`);
  }
  
  console.log("\n✅ Xong! Chỉ cần chạy 1 lần duy nhất.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});