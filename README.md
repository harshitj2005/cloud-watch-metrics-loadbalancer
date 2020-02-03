# Problem statement
Sometime we want to visalualise all our graph (including metrics and other business data) under single dashboard. Now AWS provides metrics for it's elastic load balancers but we can visualise them only on AWS console.

# Solution Description

This function will fetch metrics from cloud watch for mentioned load balancers or all of the available load balancers in a specified region and put them on elastic search. From elastic search we can easily visualise them on various dashboard (for ex: kibana, redash, etc)

## Steps to run this application on lambda
1. create a folder in your system and save index.js and package.json in the same.
2. Run `npm i` inside that folder from terminal
3. After `npm i` runs successfully there will be a new folder created node_modules.
4. compress the contents of folders into a zip file and upload them on lambda. (Important note: compress the content of folder not the folder itself as if you compress the folder then it creates another folder of same name inside the zipped file)

### why compression is required for running the file inside the lambda
As we are using 2 npm modules which lambda doesnot provide, so we need to provide those modules to make the execution success.

### putting right configurations in the code
before running the code in lambda, please make sure to put up the right configuration inside the code. Some variables which you should check before making it a final go
1. ElasticSearchHost
2. Environment
3. StartTime
4. limitLoadBalancer
5. loadBalancerNames
6. region
7. loadBalancerAvailabilityZones