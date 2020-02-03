const AWS = require('aws-sdk');
const async = require('async');
const elasticsearch = require('elasticsearch');
const region = 'ap-south-1'; //region for which you want to fetch metrics
const cloudwatch = new AWS.CloudWatch({ region: region});

const ElasticSearchHost = 'https://localhost:9200';
const Environment = 'production';//environment name which you want to put in the elasticsearch
const EndTime = new Date;
const StartTime = new Date(EndTime - 15*60*1000);// here we are fetching metrics current minus 15 minutes
// metric names which we want to fetch from cloudwatch
const Metrics = {
    'LoadBalancer': [{
        'Namespace': 'AWS/ELB',
        'MetricNames': ['HealthyHostCount','UnHealthyHostCount','RequestCount','HTTPCode_Backend_2XX','HTTPCode_Backend_3XX','HTTPCode_Backend_4XX','HTTPCode_Backend_5XX']
    }],
    'ApplicationLoadBalancer': [{
        'Namespace': 'AWS/ApplicationELB',
        'MetricNames': ['ActiveConnectionCount','ClientTLSNegotiationErrorCount','ConsumedLCUs','DroppedInvalidHeaderRequestCount','ForwardedInvalidHeaderRequestCount','HTTP_Fixed_Response_Count','HTTP_Redirect_Count','HTTP_Redirect_Url_Limit_Exceeded_Count','HTTPCode_ELB_3XX_Count','HTTPCode_ELB_4XX_Count','HTTPCode_ELB_5XX_Count','HTTPCode_ELB_500_Count','HTTPCode_ELB_502_Count','HTTPCode_ELB_503_Count','HTTPCode_ELB_504_Count','IPv6ProcessedBytes','IPv6RequestCount','NewConnectionCount','ProcessedBytes','RejectedConnectionCount','RequestCount','RuleEvaluations']
    }],
    'NetworkLoadBalancer': [{
        'Namespace': 'AWS/NetworkELB',
        'MetricNames': ['ActiveFlowCount','ActiveFlowCount_TCP','ActiveFlowCount_TLS','ActiveFlowCount_UDP','ClientTLSNegotiationErrorCount','ConsumedLCUs','ConsumedLCUs_TCP','ConsumedLCUs_TLS','ConsumedLCUs_UDP','HealthyHostCount','NewFlowCount','NewFlowCount_TCP','NewFlowCount_TLS','NewFlowCount_UDP','ProcessedBytes','ProcessedBytes_TCP','ProcessedBytes_TLS','ProcessedBytes_UDP','TargetTLSNegotiationErrorCount','TCP_Client_Reset_Count','TCP_ELB_Reset_Count','TCP_Target_Reset_Count','UnHealthyHostCount']
    }]
};
/* 
    variable which decide if we want fetch all loadbalancer available in the 
    region or some specific loadbalancers mentioned in variable loadBalancerNames
    possible value : limitLoadBalancer: [true, false]
    if limitLoadBalancer:true then name mentioned in loadBalancerNames array will be matched
*/
const limitLoadBalancer = false;
const loadBalancerNames = ['load_balancer_1'];
const api_version_dec_15 = '2015-12-01';
const application_elb = "application";
const network_elb = "network";
//availability zones for which we want to fetch metrics of load balancer
const loadBalancerAvailabilityZones = ['a', 'b', 'c'];
console.log('Start: ',StartTime,' : End: ', EndTime);

exports.handler = function (event, context) {
    findLoadBalancerName(function(err) {
        if (err) {
            console.log(err, err.stack);
            errorExit(err, context);
        } else {
            context.succeed();
        }
    });
};

async function getMetricStatistics(type, dimensions) {
    return new Promise((resolve, reject) => {
        async.eachSeries(Metrics[type], (metric, callbackOuter) => {
            var Namespace = metric.Namespace;
            async.eachSeries(metric.MetricNames, (MetricName, callbackInner) => {
                var bulkData = {body:[],type:""};
                var params = {
                    Period: 60,
                    StartTime: StartTime,
                    EndTime: EndTime,
                    MetricName: MetricName,
                    Namespace: Namespace,
                    Statistics: ['SampleCount', 'Average', 'Sum', 'Minimum', 'Maximum'],
                    Dimensions: dimensions
                };
                console.log('Fetching ' + Namespace + ':' + MetricName + ' for ' + dimensions[0].Value);
                cloudwatch.getMetricStatistics(params, function (err, data) {
                    if (err) {
                        console.log("error occured in getMetricStatistics:",err, err.stack);
                        callbackInner(null);
                    } else {
                        data.Datapoints.forEach(function (datapoint) {
                            datapoint.Namespace = Namespace;
                            datapoint.MetricName = MetricName;
                            datapoint.Dimension = dimensions[0];
                            datapoint.Environment = Environment;
                            if (
                                Namespace == 'AWS/ELB' || 
                                Namespace == 'AWS/ApplicationELB' || 
                                Namespace == 'AWS/NetworkELB'
                            ) {
                                datapoint.AvailabilityZone = dimensions[1].Value;
                            }
                            // push instruction
                            bulkData.body.push({
                                index: {
                                    _index: 'cloudwatch',
                                    _type: type,
                                    _id: Math.floor((datapoint.Timestamp.getTime() / 1000) + randomInt(100,999))
                                }
                            });
                            bulkData.type = "cloudwatch-metrics";
                            // push data
                            bulkData.body.push(datapoint);
                        });
                        // console.log("sendToElasticSearch bulkData: ",JSON.stringify(bulkData));
                        sendToElasticSearch(bulkData, (err) => {
                            if(err){
                                console.log("error occured in sendToElasticSearch",err);
                                callbackInner(null);
                            } else {
                                callbackInner(null);
                            }
                        });
                    }
                });
            }, () => {
                callbackOuter(null);
            });
        }, () => {
            resolve(null);
        });
    })
};

async function findLoadBalancerName(callback) {
    async.waterfall([
        //get classic load balancer
        (next) => {
            var elb = new AWS.ELB({ region: region});
            elb.describeLoadBalancers({}, function(err, data) {
                if (err) {
                    next(err);
                } else {
                    var found = 0;
                    async.eachSeries(data.LoadBalancerDescriptions, (item, callbackInner) => {
                        let dumpMetric = false;
                        if(limitLoadBalancer){
                            if(loadBalancerNames.includes(item.LoadBalancerName)){
                                found++;
                                dumpMetric = true;
                            }
                        } else {
                            found++;
                            dumpMetric = true;
                        }
                        if(dumpMetric){
                            async.eachSeries(loadBalancerAvailabilityZones, (value, cb) => {
                                getMetricStatistics('LoadBalancer', [
                                    {Name: 'LoadBalancerName', Value: item.LoadBalancerName},
                                    {Name: 'AvailabilityZone', Value: 'ap-south-1'+value}
                                ]).then(() => {
                                    cb(null);
                                }, (err) => {
                                    console.log("findLoadBalancerName getMetricStatistics error:",err)
                                    cb(null);
                                });
                            }, () => {
                                callbackInner(null);
                            });
                        } else {
                            callbackInner(null);
                        }
                    }, () => {
                        if(found == 0 || found < 0){
                            console.log("no classic LoadBalancer found");
                        }
                        next(null);
                    });
                }
            });
        },
        //get application and network load balancer
        (next) => {
            var elbv2 = new AWS.ELBv2({apiVersion: api_version_dec_15,region: region});
            elbv2.describeLoadBalancers({}, function(err, data) {
                if (err) {
                    next(err);
                } else {
                    var found = 0;
                    async.eachSeries(data.LoadBalancers, (item, callbackInner) => {
                        let dumpMetric = false;
                        if(limitLoadBalancer){
                            if(loadBalancerNames.includes(item.LoadBalancerName)){
                                found++;
                                dumpMetric = true;
                            }
                        } else {
                            found++;
                            dumpMetric = true;
                        }
                        if(dumpMetric){
                            var nameArray = item.LoadBalancerArn.split("/");
                            //get last part of arn
                            nameArray.shift();
                            //after removing first part of arn join back the string
                            var LoadBalancer = nameArray.join("/");
                            if(item.Type == application_elb){
                                async.eachSeries(loadBalancerAvailabilityZones, (value, cb) => {
                                    getMetricStatistics('ApplicationLoadBalancer', [
                                        {Name: 'LoadBalancer', Value: LoadBalancer},
                                        {Name: 'AvailabilityZone', Value: 'ap-south-1'+value}
                                    ]).then(() => {
                                        cb(null);
                                    }, (err) => {
                                        console.log("findLoadBalancerName getMetricStatistics error:",err)
                                        cb(null);
                                    });
                                }, () => {
                                    callbackInner(null);
                                });
                            } else if(item.Type == network_elb) {
                                async.eachSeries(loadBalancerAvailabilityZones, (value, cb) => {
                                    getMetricStatistics('NetworkLoadBalancer', [
                                        {Name: 'LoadBalancer', Value: LoadBalancer},
                                        {Name: 'AvailabilityZone', Value: 'ap-south-1'+value}
                                    ]).then(() => {
                                        cb(null);
                                    }, (err) => {
                                        console.log("findLoadBalancerName getMetricStatistics error:",err)
                                        cb(null);
                                    });
                                }, () => {
                                    callbackInner(null);
                                });
                            } else {
                                console.log("no supported type found");
                                callbackInner(null);
                            }
                        } else {
                            callbackInner(null);
                        }
                    }, () => {
                        if(found == 0 || found < 0){
                            console.log("no application/classic LoadBalancer found");
                        }
                        next(null);
                    });
                }
            });
        }
    ],(err) => {
        if(err){
            callback(err);
        } else {
            callback(null);
        }
    })
};

async function sendToElasticSearch(bulkData, cb) {
    if (bulkData.body.length > 0) {
        console.log('Sending ' + (bulkData.body.length/2) + ' metrics to ElasticSearch:');
        var elasticSearchClient = new elasticsearch.Client({ host: ElasticSearchHost });
        elasticSearchClient.bulk(bulkData, function(err, data) {
            if (err) {
                cb(err);
            } else {
                console.log("data.errors",data.errors,"data.items",data.items.length,'Send successful bulkData.body.length' + (bulkData.body.length/2) + ' metrics to ElasticSearch:');
                cb(null);
            }
        });
    } else {
        cb(null);
    }
};

function errorExit(message, context) {
    var res = {Error: message};
    console.log(res.Error);
    context.fail(res);
};
function randomInt(low, high) {
    return Math.floor(Math.random() * (high - low) + low)
}