import { SuiMaster } from 'suidouble';
import config from './config.js';
import Miner from './includes/Miner.js';
import FomoMiner from './includes/fomo/FomoMiner.js';
import axios from 'axios'; // Thêm axios để gọi API

// Hàm retry để thử lại khi có lỗi
const retry = async (fn, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i < retries - 1) {
                console.warn(`Thử lại lần ${i + 1}/${retries} sau ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay)); // Chờ trước khi thử lại
            } else {
                throw error; // Ném lỗi nếu vượt quá số lần thử
            }
        }
    }
};

// Hàm để kiểm tra giá trị amount
const checkAmount = async () => {
    const rpcUrl = 'https://mainnet-rpc.sui.chainbase.online/';
    const objectId = '0xa340e3db1332c21f20f5c08bef0fa459e733575f9a7e2f5faca64f72cd5a54f2';
    const payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "suix_queryTransactionBlocks",
        "params": [
            {
                "filter": {
                    "InputObject": objectId
                },
                "options": null
            },
            null,  // Không có con trỏ paging, bắt đầu từ giao dịch đầu tiên
            1,     // Lấy 1 giao dịch
            true   // Sắp xếp theo thứ tự giảm dần (mới nhất trước)
        ]
    };

    try {
        const response = await retry(() => axios.post(rpcUrl, payload), 5, 2000); // Thử lại 5 lần nếu có lỗi
        const data = response.data;

        if (data.result && data.result.data.length > 0) {
            const latestTransaction = data.result.data[0];
            const transactionDigest = latestTransaction.digest;

            // Gọi API lấy transaction block
            const blockResponse = await retry(() => axios.post(rpcUrl, {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sui_getTransactionBlock",
                "params": [
                    transactionDigest,
                    {
                        "showInput": false,
                        "showRawInput": false,
                        "showEffects": false,
                        "showEvents": false,
                        "showObjectChanges": false,
                        "showBalanceChanges": true,  // Chỉ hiển thị thay đổi số dư
                        "showRawEffects": false
                    }
                ]
            }), 5, 2000);

            const blockData = blockResponse.data;
            if (blockData.result && blockData.result.balanceChanges) {
                const balanceChanges = blockData.result.balanceChanges;

                for (let change of balanceChanges) {
                    if (change.coinType === "0xa340e3db1332c21f20f5c08bef0fa459e733575f9a7e2f5faca64f72cd5a54f2::fomo::FOMO") {
                        const amount = change.amount;
                        console.log("Current amount:", amount);
                        return amount;
                    }
                }
            }
        } else {
            console.log("No transactions found.");
        }

        return null;
    } catch (error) {
        console.error("Error fetching transaction:", error.message);
        return null;
    }
};

// Hàm chạy chính cho mining
const run = async () => {
    const phrase = config.phrase;
    const chain = config.chain;

    if (!config.phrase || !config.chain) {
        throw new Error('phrase and chain parameters are required');
    }

    const suiMasterParams = {
        client: chain,
        debug: !!config.debug,
    };
    if (phrase.indexOf('suiprivkey') === 0) {
        suiMasterParams.privateKey = phrase;
    } else {
        suiMasterParams.phrase = phrase;
    }
    const suiMaster = new SuiMaster(suiMasterParams);
    await suiMaster.initialize();

    console.log('suiMaster connected as ', suiMaster.address);

    const miners = {};
    let previousAmount = null; // Lưu giá trị amount trước đó

    const doMine = async (minerInstance) => {
        while (true) {
            try {
                const amount = await checkAmount(); // Kiểm tra giá trị amount

                if (amount === "2966979980") { // Nếu amount khớp
                    if (amount !== previousAmount) { // Nếu amount thay đổi
                        previousAmount = amount;
                        console.log('Mining successful with amount 2966979980');
                        await minerInstance.mine(); // Chạy mining
                    } else {
                        console.log('Amount unchanged, continuing mining...');
                        await minerInstance.mine(); // Tiếp tục mining ngay cả khi amount không thay đổi
                    }
                } else {
                    console.log('Amount does not match, waiting for next check...');
                }
            } catch (e) {
                console.error(e);
                console.log('Error occurred, retrying mining...');
            }
            await new Promise((res) => setTimeout(res, 3500)); // Tạm dừng 5 giây trước khi kiểm tra tiếp
        }
    };

    if (config.do.meta) {
        const miner = new Miner({
            suiMaster,
            packageId: config.packageId,
            blockStoreId: config.blockStoreId,
            treasuryId: config.treasuryId,
        });
        miners.meta = miner;
        doMine(miners.meta);
    }
    if (config.do.fomo) {
        const fomoMiner = new FomoMiner({
            suiMaster,
            packageId: config.fomo.packageId,
            configId: config.fomo.configId,
            buses: config.fomo.buses,
        });
        miners.fomo = fomoMiner;
        doMine(miners.fomo);
    }
};

run()
    .then(() => {
        console.log('Running');
    });
